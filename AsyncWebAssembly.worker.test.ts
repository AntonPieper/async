import { WebWorkerCommunicator } from "./AsyncWebAssembly.js";

const channel = await new WebWorkerCommunicator().bind();
const encoder = new TextDecoder();
console.time("package.json");
console.log(encoder.decode(channel.request("loadFile", "./package.json")));
console.timeEnd("package.json");
console.time("AsyncWebAssembly.ts");
console.log(encoder.decode(channel.request("loadFile", "./AsyncWebAssembly.ts")));
console.timeEnd("AsyncWebAssembly.ts");
