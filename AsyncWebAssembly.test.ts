import { MainThreadCommunicator } from "./AsyncWebAssembly.js";

const cache = new Map<string, ArrayBuffer>();
async function loadFile(path: string) {
  let result = cache.get(path);
  if (result !== undefined) {
    return result;
  }
  const label = `loadFile:${path}`;
  console.time(label);
  const res = await fetch(path);
  const blob = await res.blob();
  result = await blob.arrayBuffer();
  cache.set(path, result);
  console.timeEnd(label);
  return result;
}

const commands = {
  loadFile,
};
await loadFile("./AsyncWebAssembly.ts");
await loadFile("./package.json");
console.group("Big");
const workerBig = new MainThreadCommunicator(1024 * 10, commands);
workerBig.start(
  new Worker(new URL("./AsyncWebAssembly.worker.test.js", import.meta.url), {
    type: "module",
  }),
);

await new Promise((res) => setTimeout(res, 2000));
console.groupEnd();

console.group("Small");
const workerSmall = new MainThreadCommunicator(12, commands);
workerSmall.start(
  new Worker(new URL("./AsyncWebAssembly.worker.test.js", import.meta.url), {
    type: "module",
  }),
);
