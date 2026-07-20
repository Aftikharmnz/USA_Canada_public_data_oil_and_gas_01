import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const outputDirectory = resolve("dist");
const rootEntry = resolve(outputDirectory, "index.html");

for (const route of ["usa", "products", "canada", "reference"]) {
  const routeDirectory = resolve(outputDirectory, route);
  await mkdir(routeDirectory, { recursive: true });
  await copyFile(rootEntry, resolve(routeDirectory, "index.html"));
}

// GitHub Pages should serve emitted assets as-is rather than running Jekyll.
await writeFile(resolve(outputDirectory, ".nojekyll"), "", "utf8");
