import { afterEach, beforeEach, describe, expect, it } from "vitest";
import net from "node:net";
import { sendMail } from "../src/utils/smtp.js";

/**
 * Minimal fake SMTP server that speaks just enough RFC 5321 for sendMail.
 * Captures the raw conversation for assertions.
 */
function startFakeSmtp(options: { reject?: number } = {}): Promise<{
  close: () => Promise<void>;
  port: number;
  transcript: () => string;
}> {
  return new Promise((resolve) => {
    const chunks: string[] = [];
    const server = net.createServer((socket) => {
      socket.write("220 fake-smtp ESMTP ready\r\n");
      let step = 0;
      socket.on("data", (data) => {
        const text = data.toString("utf8");
        chunks.push(text);
        if (options.reject && step === options.reject) {
          socket.write("550 rejected\r\n");
          socket.end();
          return;
        }
        if (text.startsWith("EHLO")) {
          socket.write("250-fake-smtp\r\n250 OK\r\n");
          step = 1;
        } else if (text.startsWith("AUTH")) {
          socket.write("334 VXNlcm5hbWU6\r\n");
          step = 2;
        } else if (step === 2) {
          socket.write("334 UGFzc3dvcmQ6\r\n");
          step = 3;
        } else if (step === 3) {
          socket.write("235 2.7.0 Authentication successful\r\n");
          step = 4;
        } else if (text.startsWith("MAIL FROM")) {
          socket.write("250 OK\r\n");
        } else if (text.startsWith("RCPT TO")) {
          socket.write("250 OK\r\n");
        } else if (text.startsWith("DATA")) {
          socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
        } else if (/[\r\n]\.\r\n$/.test(text)) {
          // DATA payload terminated by <CR><LF>.<CR><LF>
          socket.write("250 2.0.0 OK queued\r\n");
        } else if (text.startsWith("QUIT")) {
          socket.end();
        }
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        close: () => new Promise((r) => server.close(() => r())),
        port: typeof address === "object" && address ? address.port : 0,
        transcript: () => chunks.join(""),
      });
    });
  });
}

describe("sendMail (SMTP client)", () => {
  let smtp: Awaited<ReturnType<typeof startFakeSmtp>>;

  beforeEach(async () => {
    smtp = await startFakeSmtp();
  });

  afterEach(async () => {
    await smtp.close();
  });

  it("completes the SMTP conversation and sends the message", async () => {
    await sendMail(
      { host: "127.0.0.1", port: smtp.port, user: "u", pass: "p", from: "bot@discorp.local" },
      "target@example.com",
      "Test subject",
      "Hello body",
    );
    const transcript = smtp.transcript();
    expect(transcript).toContain("EHLO discorp");
    expect(transcript).toContain("MAIL FROM:<bot@discorp.local>");
    expect(transcript).toContain("RCPT TO:<target@example.com>");
    expect(transcript).toContain("Subject: Test subject");
    expect(transcript).toContain("Hello body");
  });

  it("works without auth when no credentials are provided", async () => {
    await sendMail(
      { host: "127.0.0.1", port: smtp.port, from: "bot@discorp.local" },
      "target@example.com",
      "No auth",
      "body",
    );
    expect(smtp.transcript()).not.toContain("AUTH");
  });

  it("rejects when the server refuses a command", async () => {
    const failing = await startFakeSmtp({ reject: 1 }); // reject after EHLO... see note
    try {
      await expect(
        sendMail(
          { host: "127.0.0.1", port: failing.port, from: "bot@discorp.local" },
          "target@example.com",
          "s",
          "b",
        ),
      ).rejects.toThrow(/SMTP/);
    } finally {
      await failing.close();
    }
  });
});
