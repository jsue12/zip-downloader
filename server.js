import express from "express";
import PDFDocument from "pdfkit";
import csvtojson from "csvtojson";

const app = express();

app.get("/generar-reporte", async (req, res) => {
  console.log("[start] /generar-reporte request received");

  try {
    const urlsParam = req.query.url;
    if (!urlsParam) {
      return res
        .status(400)
        .send("Error: Debes incluir el parámetro 'url' con las URLs separadas por comas.");
    }

    const urls = urlsParam.split(",").map(u => u.trim()).filter(Boolean);
    const csvDataArr = [];

    for (const u of urls) {
      try {
        const resp = await fetch(u);
        if (!resp.ok) {
          console.warn("No se pudo leer:", u);
          continue;
        }
        const text = await resp.text();
        const json = await csvtojson().fromString(text);
        csvDataArr.push({ url: u, data: json });
      } catch (err) {
        console.error("Error cargando:", u, err);
      }
    }

    // =============================
    // ARCHIVO brawny-letters
    // =============================
    const brawnyEntry = csvDataArr.find(c => c.url.toLowerCase().includes("brawny-letters"));
    if (!brawnyEntry || !brawnyEntry.data?.length) {
      return res.status(404).send("No se encontró o no se pudo leer brawny-letters.csv");
    }

    const brawnyRow = brawnyEntry.data[0] || {};
    const keysB = Object.keys(brawnyRow);
    const recibidos = parseFloat(brawnyRow[keysB[0]] || 0);
    const entregados = parseFloat(brawnyRow[keysB[1]] || 0);
    const saldo = parseFloat(brawnyRow[keysB[2]] || 0);

    // =============================
    // ARCHIVOS SECUNDARIOS
    // =============================
    const vagueEntry = csvDataArr.find(c => c.url.toLowerCase().includes("vague-stage"));
    const vagueRecords = vagueEntry?.data?.filter(r => Object.keys(r).length) || [];

    const tellingEntry = csvDataArr.find(c => c.url.toLowerCase().includes("telling-match"));
    const tellingRecords = tellingEntry?.data?.filter(r => Object.keys(r).length) || [];

    const pagosEntry = csvDataArr.find(c => c.url.toLowerCase().includes("pagos"));
    const pagosRecords = pagosEntry?.data?.filter(r => Object.keys(r).length) || [];

    // =============================
    // CREAR PDF
    // =============================
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=reporte.pdf");

    const doc = new PDFDocument({ margin: 50, size: "A4" });
    doc.pipe(res);

    const formatNumber = n => {
      const num = parseFloat(String(n).replace(/[^\d.-]/g, "")) || 0;
      return num.toLocaleString("es-ES", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
        useGrouping: true
      });
    };
    const fillRect = (d, x, y, w, h, c) => d.save().rect(x, y, w, h).fill(c).restore();
    const strokeRect = (d, x, y, w, h) => d.save().strokeColor("#000").rect(x, y, w, h).stroke().restore();

    // =============================
    // ENCABEZADO PRINCIPAL
    // =============================
    doc.font("Helvetica-Bold").fontSize(14).text("REPORTE DE TRANSACCIONES", { align: "center" });
    doc.moveDown();
    doc.font("Helvetica-Bold").fontSize(11).text("TESORERO:", { continued: true })
      .font("Helvetica").text(" JUAN PABLO BARBA MEDINA");
    doc.font("Helvetica-Bold").text("FECHA DEL INFORME:", { continued: true })
      .font("Helvetica").text(` ${new Date().toLocaleDateString("es-EC")}`);
    doc.moveDown();

    // =============================
    // RESUMEN EJECUTIVO (siempre)
    // =============================
    doc.font("Helvetica-Bold").fontSize(12).text("RESUMEN EJECUTIVO");
    doc.moveDown(0.5);
    doc.font("Helvetica").fontSize(11);
    doc.text(`VALORES RECIBIDOS (+): ${formatNumber(recibidos)}`);
    doc.text(`VALORES ENTREGADOS (-): ${formatNumber(entregados)}`);
    doc.font("Helvetica-Bold").text(`SALDO TOTAL (=): ${formatNumber(saldo)}`);
    doc.moveDown().moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown();

    // =============================
    // SECCIÓN 1: LISTADO DE ESTUDIANTES
    // =============================
    if (vagueRecords.length > 0) {
      // ... (tu bloque completo de tabla LISTADO DE ESTUDIANTES)
      // simplemente conserva todo ese bloque
      // No cambies lógica interna — solo está protegido por el if
      // ✅ toda esa tabla solo se renderiza si hay registros
      // (no repito aquí para ahorrar espacio)
    }

    // =============================
    // SECCIÓN 2: TRANSACCIONES DE COBRO
    // =============================
    if (tellingRecords.length > 0) {
      // ... (tu bloque completo de tabla TELLING-MATCH)
    }

    // =============================
    // SECCIÓN 3: RESUMEN DE VALORES PAGADOS
    // =============================
    if (vagueRecords.length > 0) {
      // ... (tu bloque del gráfico textual con "=")
    }

    // =============================
    // SECCIÓN 4: TRANSACCIONES DE PAGO
    // =============================
    if (pagosRecords.length > 0) {
      // ... (tu bloque completo de tabla pagos.csv)
    }

    // =============================
    // FINALIZAR PDF
    // =============================
    doc.end();
    console.log("[done] PDF stream ended ✅");

  } catch (err) {
    console.error("Error generando PDF:", err);
    if (!res.headersSent) res.status(500).send(err.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
