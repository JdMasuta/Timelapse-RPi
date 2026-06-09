// services/NotificationService.js
// Fires notifications on key system events. Two transports:
//   - webhook: native HTTP(S) POST (no dependency)
//   - email:   via nodemailer (lazy-required; skipped with a warning if not installed)
// Each transport is gated by its enable flag in configuration. notify() never throws.

const https = require("https");
const http = require("http");
const { URL } = require("url");
const Logger = require("./camera/Logger");

class NotificationService {
  _config() {
    return {
      webhookEnabled: process.env.NOTIFY_WEBHOOK_ENABLED === "true",
      webhookUrl: process.env.NOTIFY_WEBHOOK_URL || "",
      emailEnabled: process.env.NOTIFY_EMAIL_ENABLED === "true",
      email: {
        host: process.env.EMAIL_HOST,
        port: parseInt(process.env.EMAIL_PORT) || 587,
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
        to: process.env.EMAIL_TO,
      },
    };
  }

  /** Fire-and-forget notification. Never throws. */
  notify(event, data = {}) {
    const cfg = this._config();
    const payload = { event, data, timestamp: new Date().toISOString() };

    if (cfg.webhookEnabled && cfg.webhookUrl) {
      this._sendWebhook(cfg.webhookUrl, payload).catch((e) =>
        Logger.warn("NotificationService", "Webhook delivery failed", {
          error: e.message,
        })
      );
    }
    if (cfg.emailEnabled) {
      this._sendEmail(cfg.email, event, payload).catch((e) =>
        Logger.warn("NotificationService", "Email delivery failed", {
          error: e.message,
        })
      );
    }
  }

  _sendWebhook(urlStr, payload) {
    return new Promise((resolve, reject) => {
      let url;
      try {
        url = new URL(urlStr);
      } catch (e) {
        return reject(new Error("Invalid webhook URL"));
      }
      const body = JSON.stringify(payload);
      const lib = url.protocol === "https:" ? https : http;
      const req = lib.request(
        url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (res) => {
          res.resume();
          res.on("end", resolve);
        }
      );
      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }

  async _sendEmail(email, event, payload) {
    if (!email.host || !email.to) return;

    let nodemailer;
    try {
      nodemailer = require("nodemailer");
    } catch (e) {
      Logger.warn(
        "NotificationService",
        "nodemailer not installed; email notification skipped (run: npm install nodemailer)"
      );
      return;
    }

    const transport = nodemailer.createTransport({
      host: email.host,
      port: email.port,
      secure: email.port === 465,
      auth: email.user ? { user: email.user, pass: email.pass } : undefined,
    });

    await transport.sendMail({
      from: email.user || "timelapse@localhost",
      to: email.to,
      subject: `Timelapse: ${event}`,
      text: JSON.stringify(payload, null, 2),
    });
  }
}

module.exports = NotificationService;
