export type Handlers = Partial<
  Record<
    string,
    (
      this: MainThreadCommunicator,
      ...args: any[]
    ) => ArrayBufferLike | PromiseLike<ArrayBufferLike>
  >
>;

function noAck() {
  throw new Error("No packet to ACK");
}

export class MainThreadCommunicator {
  private buffer: SharedArrayBuffer;
  private view: Int32Array;
  private lock: (count: number) => void = noAck;

  constructor(
    bufferSize: number,
    private handlers: Handlers,
  ) {
    this.buffer = new SharedArrayBuffer(bufferSize);
    this.view = new Int32Array(this.buffer);
  }

  start(worker: Worker) {
    worker.postMessage({ type: "init", buffer: this.buffer });
    worker.onmessage = this.handleWorkerMessage.bind(this);
    return this;
  }

  private async handleWorkerMessage(event: MessageEvent) {
    const { type, requestType, payload } = event.data;
    switch (type) {
      case "req":
        return this.handleRequest(requestType, payload);
      case "ack":
        this.lock(payload);
        this.lock = noAck;
        break;
      default:
        console.error("Illegal Event:", event);
        throw new Error("Illegal Event");
    }
  }

  private async handleRequest(requestType: string, payload: unknown[]) {
    const handler = this.handlers[requestType];
    if (!handler) {
      throw new Error(`No handler for ${requestType}`);
    }
    const result = await handler.apply(this, payload);
    const totalLength = result.byteLength;
    let offset = 0;
    const segmentSize = this.buffer.byteLength - 8; // Adjusted for metadata

    while (offset < totalLength) {
      const chunkLength = Math.min(segmentSize, totalLength - offset);
      this.view[1] = totalLength - offset; // Remaining bytes before packet
      new Uint8Array(this.buffer, 8).set(
        new Uint8Array(result, offset, chunkLength),
      );

      const ack = new Promise<number>((resolve) => (this.lock = resolve));
      Atomics.store(this.view, 0, 1);
      Atomics.notify(this.view, 0);
      await ack;

      offset += chunkLength;
    }
  }
}

export class WebWorkerCommunicator {
  private data?: { buffer: SharedArrayBuffer; view: Int32Array };

  bind() {
    return new Promise<this>((resolve, reject) => {
      self.addEventListener("message", (event) => {
        if (event.data.type === "init") {
          this.data = {
            buffer: event.data.buffer,
            view: new Int32Array(event.data.buffer),
          };
          const flag = this.data.view[0];
          if (flag !== 0) {
            throw new Error(
              `Imvalid state: shared data[0] != 0 (data[0] = ${flag})`,
            );
          }
          resolve(this);
        } else {
          reject(new Error("Invalid message"));
        }
      });
    });
  }

  request(requestType: string, ...payload: unknown[]): Uint8Array {
    if (!this.data) {
      throw new Error("Shared buffer not initialized");
    }

    self.postMessage({ type: "req", requestType, payload });

    let totalSize = 0;
    let receivedSize = 0;
    let result: Uint8Array;
    const chunkLength = this.data.buffer.byteLength - 8;
    do {
      Atomics.wait(this.data.view, 0, 0);

      const remainingBeforePacket = this.data.view[1];
      if (totalSize === 0) {
        // The first packet gives us the total size
        totalSize = remainingBeforePacket;
        result = new Uint8Array(totalSize);
      }

      const length = Math.min(totalSize - receivedSize, chunkLength);
      const chunk = new Uint8Array(this.data.buffer, 8, length);
      result!.set(chunk, receivedSize);

      receivedSize += chunkLength;

      self.postMessage({ type: "ack" });
      Atomics.store(this.data.view, 0, 0); // Reset the flag for the next segment
    } while (receivedSize < totalSize);

    return result!;
  }
}
