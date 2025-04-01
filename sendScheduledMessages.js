require("dotenv").config();
import pool from "./lib/db";
import twilio from "twilio";
import fetch from "node-fetch";

const twilioClient = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);
const WABA_TOKEN = process.env.TWILIO_WABA_TOKEN;
const PHONE_ID = process.env.TWILIO_PHONE_NUMBER_ID;
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
      // Buscar datos del negocio
      const negocio = await pool.query(
        "SELECT * FROM tenants WHERE id = $1",
        [msg.tenant_id]
      );
      const tenant = negocio.rows[0];
      const canal = msg.canal;

      if (canal === "whatsapp") {
        // Usar plantilla si existe
        if (msg.template_name) {
          await fetch(`https://graph.facebook.com/v18.0/${PHONE_ID}/messages`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${WABA_TOKEN}`,
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              to: msg.contacto.replace("whatsapp:", ""),
              type: "template",
              template: {
                name: msg.template_name,
                language: {
                  code: msg.template_language || "es",
                },
              },
            }),
          });
        } else {
          // Enviar mensaje directo desde Twilio
          await twilioClient.messages.create({
            body: msg.contenido,
            from: `whatsapp:${tenant.twilio_number}`,
            to: msg.contacto,
          });
        }
      } else if (canal === "facebook") {
        await fetch(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipient: { id: msg.contacto },
            message: { text: msg.contenido },
          }),
        });
      }

      // Guardar mensaje en historial
      await pool.query(
        `INSERT INTO messages (tenant_id, sender, content, canal, timestamp)
         VALUES ($1, 'assistant', $2, $3, NOW())`,
        [msg.tenant_id, msg.contenido, canal]
      );

      // Marcar como enviado
      await pool.query(
        "UPDATE mensajes_programados SET enviado = true WHERE id = $1",
        [msg.id]
      );

      console.log(`✅ Mensaje enviado a ${msg.contacto} (${canal})`);
    } catch (err) {
      console.error(`❌ Error al enviar mensaje a ${msg.contacto}:`, err);
    }
  }

  console.log("✅ Job finalizado.");
  process.exit(0);
}

main();
