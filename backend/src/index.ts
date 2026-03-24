import type { DefineAPI, SDK } from "caido:plugin";
import { promises as fsp } from "fs";
import os from "os";

export type API = DefineAPI<{
  getDefaultDir: typeof getDefaultDir;
  saveFiles: typeof saveFiles;
}>;

async function getDefaultDir(_sdk: SDK<API>): Promise<string> {
  return os.homedir() + "/Downloads";
}

async function saveFiles(
  _sdk: SDK<API>,
  dir: string,
  files: { name: string; content: string }[]
): Promise<{ ok: boolean; error?: string }> {
  try {
    await fsp.mkdir(dir, { recursive: true });
    for (const file of files) {
      const sep = dir.endsWith("/") || dir.endsWith("\\") ? "" : "/";
      await fsp.writeFile(dir + sep + file.name, file.content, { encoding: "utf8" });
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export function init(sdk: SDK<API>) {
  sdk.api.register("getDefaultDir", getDefaultDir);
  sdk.api.register("saveFiles", saveFiles);
}
