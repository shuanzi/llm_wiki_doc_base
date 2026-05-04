import * as fs from "node:fs";
import * as path from "node:path";

const repoRoot = path.resolve(__dirname, "..");
const assets = [
  {
    from: path.join(repoRoot, "src", "core", "defuddle-parser-bridge.mjs"),
    to: path.join(repoRoot, "dist", "core", "defuddle-parser-bridge.mjs"),
  },
];

for (const asset of assets) {
  fs.mkdirSync(path.dirname(asset.to), { recursive: true });
  fs.copyFileSync(asset.from, asset.to);
}
