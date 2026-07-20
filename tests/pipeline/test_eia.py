from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "pipeline"))

from energy_dashboard.eia import (
    EIAClient,
    EIACredentialError,
    EIAQuerySpec,
    EIAResponseError,
    EIASort,
    HTTPResponse,
    RetryPolicy,
    redact_url,
)


FIXTURES = Path(__file__).with_name("fixtures")
SECRET = "fixture-secret-that-must-never-appear-in-errors"


class FixtureTransport:
    def __init__(self, responses: list[HTTPResponse]) -> None:
        self.responses = list(responses)
        self.urls: list[str] = []

    def __call__(self, url: str, timeout_seconds: float) -> HTTPResponse:
        self.urls.append(url)
        return self.responses.pop(0)


def response_fixture(name: str, status: int = 200) -> HTTPResponse:
    return HTTPResponse(status, {}, (FIXTURES / name).read_bytes())


def query() -> EIAQuerySpec:
    return EIAQuerySpec(
        route="/v2/petroleum/example/data/",
        frequency="weekly",
        data_fields=("value",),
        facets=(("process", ("YUP",)), ("duoarea", ("R20", "R10"))),
        start="2026-07-01",
        sort=(EIASort("period"), EIASort("duoarea")),
        identity_fields=("period", "duoarea"),
    )


class EIAClientTests(unittest.TestCase):
    def test_missing_environment_credential_fails_before_transport(self) -> None:
        transport = FixtureTransport([])
        with self.assertRaises(EIACredentialError) as context:
            EIAClient(environment={}, transport=transport).fetch(query())
        self.assertEqual(transport.urls, [])
        self.assertNotIn(SECRET, str(context.exception))

    def test_deterministic_pagination_and_generic_facets(self) -> None:
        transport = FixtureTransport(
            [response_fixture("eia_page_0.json"), response_fixture("eia_page_2.json")]
        )
        result = EIAClient(
            environment={"EIA_API_KEY": SECRET}, transport=transport, page_size=2
        ).fetch(query())

        self.assertEqual(result.total, 3)
        self.assertEqual(result.request_count, 2)
        self.assertEqual(
            [(row["period"], row["duoarea"]) for row in result.records],
            [("2026-07-03", "R10"), ("2026-07-10", "R10"), ("2026-07-10", "R20")],
        )
        first = parse_qs(urlsplit(transport.urls[0]).query)
        second = parse_qs(urlsplit(transport.urls[1]).query)
        self.assertEqual(first["facets[duoarea][]"], ["R10", "R20"])
        self.assertEqual(first["offset"], ["0"])
        self.assertEqual(second["offset"], ["2"])
        self.assertEqual(first["sort[1][column]"], ["duoarea"])
        self.assertNotIn(SECRET, repr(result))
        self.assertIn("%5BREDACTED%5D", redact_url(transport.urls[0]))

    def test_retry_after_is_bounded_and_errors_do_not_leak_key(self) -> None:
        page = response_fixture("eia_page_0.json")
        empty_payload = json.dumps({"response": {"total": "0", "data": []}}).encode()
        transport = FixtureTransport(
            [HTTPResponse(429, {"Retry-After": "9999"}, b""), HTTPResponse(200, {}, empty_payload)]
        )
        sleeps: list[float] = []
        result = EIAClient(
            environment={"EIA_API_KEY": SECRET},
            transport=transport,
            sleeper=sleeps.append,
            retry_policy=RetryPolicy((0.01,), maximum_retry_after_seconds=2),
        ).fetch(query())
        self.assertEqual(result.total, 0)
        self.assertEqual(sleeps, [2])

        rejected = FixtureTransport([HTTPResponse(403, {}, page.body)])
        with self.assertRaises(EIACredentialError) as context:
            EIAClient(environment={"EIA_API_KEY": SECRET}, transport=rejected).fetch(query())
        self.assertNotIn(SECRET, str(context.exception))
        self.assertNotIn("api_key=", str(context.exception))

    def test_non_retryable_and_structurally_invalid_responses_fail_closed(self) -> None:
        sleeps: list[float] = []
        transport = FixtureTransport([HTTPResponse(400, {}, b'{"error":"bad"}')])
        with self.assertRaises(EIAResponseError):
            EIAClient(
                environment={"EIA_API_KEY": SECRET}, transport=transport, sleeper=sleeps.append
            ).fetch(query())
        self.assertEqual(sleeps, [])

        invalid = FixtureTransport([HTTPResponse(200, {}, b'{"response":{"total":"3","data":[]}}')])
        with self.assertRaisesRegex(EIAResponseError, "ended before total"):
            EIAClient(environment={"EIA_API_KEY": SECRET}, transport=invalid).fetch(query())

    def test_query_rejects_arbitrary_hosts_and_embedded_credentials(self) -> None:
        for route in ("https://example.com/v2/data", "/v2/data?api_key=secret"):
            with self.assertRaises(ValueError):
                EIAQuerySpec(route=route, frequency="weekly", data_fields=("value",))
        with self.assertRaisesRegex(ValueError, "Credentials"):
            EIAQuerySpec(
                route="/v2/test/data", frequency="weekly", data_fields=("value",),
                extra_parameters=(("api_key", SECRET),),
            )


if __name__ == "__main__":
    unittest.main()
