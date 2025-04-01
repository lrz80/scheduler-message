require("dotenv").config();
const pool = require("./lib/db");
const twilio = require("twilio");
const fetch = require("node-fetch");

const twilioClient = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);
const PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN;

async function main() {
  console.log("🚀 Verificando mensajes programados...");

  const res = await pool.query(`
    SELECT * FROM mensajes_programados
    WHERE enviado = false AND fecha_envio <= NOW()
  `);

  const mensajes = res.rows;

  for (const msg of mensajes) {
    try {
      const negocio = await pool.query(
        "SELECT * FROM tenants WHERE id = $1",
        [msg.tenant_id]
      );
      const tenant = negocio.rows[0];

      if (msg.canal === "whatsapp") {
        await twilioClient.messages.create({
          body: msg.contenido,
          from: `whatsapp:${tenant.twilio_number}`,
          to: msg.contacto,
        });
      } else if (msg.canal === "facebook") {
        await fetch(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipient: { id: msg.contacto },
            message: { text: msg.contenido },
          }),
        });
      }

      await pool.query(
        `INSERT INTO messages (tenant_id, sender, content, canal, timestamp)
         VALUES ($1, 'assistant', $2, $3, NOW())`,
        [msg.tenant_id, msg.contenido, msg.canal]
      );

      await pool.query(
        "UPDATE mensajes_programados SET enviado = true WHERE id = $1",
        [msg.id]
      );

      console.log(`✅ Mensaje enviado a ${msg.contacto} (${msg.canal})`);
    } catch (err) {
      console.error(`❌ Error al enviar mensaje a ${msg.contacto}:`, err);
    }
  }

  console.log("✅ Job finalizado.");
  process.exit(0);
}

main();
