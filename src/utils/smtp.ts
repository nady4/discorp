import net from "node:net";

export interface SmtpOptions {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from: string;
}

function base64(s: string): string {
  return Buffer.from(s, "utf8").toString("base64");
}

/**
 * Minimal SMTP client (RFC 5321) using node:net — no dependencies.
 * Supports optional AUTH LOGIN and sends one plain-text message.
 */
export async function sendMail(opts: SmtpOptions, to: string, subject: string, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: opts.host, port: opts.port });
    let buffer = "";
    let step = 0; // 0 = waiting for greeting; then indexes into steps
    let done = false;

    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      socket.destroy();
      if (err) reject(err);
      else resolve();
    };

    const timeout = setTimeout(() => finish(new Error("SMTP timeout")), 30_000);
    socket.on("close", () => clearTimeout(timeout));
    socket.on("error", (err) => finish(err));

    const auth = Boolean(opts.user && opts.pass);
    const steps: Array<[string, number]> = auth
      ? [
          ["EHLO discorp\r\n", 250],
          ["AUTH LOGIN\r\n", 334],
          [`${base64(opts.user!)}\r\n`, 334],
          [`${base64(opts.pass!)}\r\n`, 235],
          [`MAIL FROM:<${opts.from}>\r\n`, 250],
          [`RCPT TO:<${to}>\r\n`, 250],
          ["DATA\r\n", 354],
          ["", 250], // the DATA payload, completed by the final reply
        ]
      : [
          ["EHLO discorp\r\n", 250],
          [`MAIL FROM:<${opts.from}>\r\n`, 250],
          [`RCPT TO:<${to}>\r\n`, 250],
          ["DATA\r\n", 354],
          ["", 250],
        ];

    const body =
      [
        `From: ${opts.from}`,
        `To: ${to}`,
        `Subject: ${subject.replace(/[\r\n]/g, " ")}`,
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=utf-8",
        "Content-Transfer-Encoding: 8bit",
        "",
        text,
        "",
        ".",
      ].join("\r\n") + "\r\n";

    socket.on("data", (data) => {
      buffer += data.toString("utf8");
      if (!/[\r\n]/.test(buffer)) return;
      const lines = buffer.split(/\r?\n/).filter((l) => l.length > 0);
      buffer = "";
      const last = lines[lines.length - 1] ?? "";
      // Multi-line replies (e.g. EHLO) end on "NNN text"; continuation lines
      // use "NNN-text" and are skipped until the final line.
      const match = /^(\d{3}) (.*)$/.exec(last);
      if (!match) return;
      const code = Number(match[1]);

      if (step === 0) {
        // Server greeting
        if (code !== 220) return finish(new Error(`SMTP ${match[0]}`));
        step = 1;
        socket.write(steps[0]![0]);
        return;
      }

      const [, replyCode] = steps[step - 1]!;
      if (code !== replyCode) return finish(new Error(`SMTP ${match[0]}`));

      if (step >= steps.length) {
        socket.write("QUIT\r\n");
        return finish();
      }
      const [cmd] = steps[step]!;
      socket.write(cmd);
      if (cmd === "") socket.write(body);
      step += 1;
    });

    socket.on("connect", () => {
      // The server greeting is handled by the data handler above.
    });
  });
}
