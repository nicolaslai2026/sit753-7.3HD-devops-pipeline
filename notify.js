const nodemailer = require('nodemailer');


let mailer = null;

function getMailer() {
  if (mailer) return mailer;
  if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER) return null;

  mailer = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT) || 587,
    secure: Number(process.env.EMAIL_PORT) === 465, 
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
  return mailer;
}

/**
 * @param {object} booking - { name, email, className, when, refCode, spots, price }
 * @returns {Promise<{ sent: boolean, info?: string }>}
 */
async function sendConfirmationEmail(booking) {
  const transport = getMailer();

  const subject = `Booking confirmed: ${booking.className} (${booking.refCode})`;
  const text =
    `Hi ${booking.name},\n\n` +
    `Your place at MMM Art Studio is confirmed.\n\n` +
    `Class:     ${booking.className}\n` +
    `When:      ${booking.when}\n` +
    `Spots:     ${booking.spots}\n` +
    `Reference: ${booking.refCode}\n\n` +
    `We look forward to seeing you. Reply to this email if you need to make a change.\n\n` +
    `— MMM Art Studio`;

  if (!transport) {
    console.log('[email:fallback] No SMTP configured. Would have sent:\n' + text);
    return { sent: false, info: 'logged-to-console' };
  }

  const info = await transport.sendMail({
    from: process.env.EMAIL_FROM || `"MMM Art Studio" <${process.env.EMAIL_USER}>`,
    to: booking.email,
    subject,
    text,
  });

  const preview = nodemailer.getTestMessageUrl(info);
  if (preview) console.log('[email] Preview URL:', preview);
  return { sent: true, info: preview || info.messageId };
}

module.exports = { sendConfirmationEmail };
