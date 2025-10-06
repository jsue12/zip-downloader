import express from "express";
import fetch from "node-fetch";
import { parse } from "csv-parse/sync";
import PDFDocument from "pdfkit";
import dayjs from "dayjs";

const app = express();

app.get("/generar-reporte", async (req, res) => {
  try {
    const urlsParam = req.query.url;
    if (!urlsParam) {
      return res.status(400).send("Error: Debes incluir el parámetro 'url' con las direcciones de los CSV separadas por comas.");
    }

    // 1️⃣ Obtener URLs de CSV
    const csvUrls = urlsParam.split(",").map((u) => u.trim()).filter(Boolean);

    if (csvUrls.length === 0) {
      return res.status(400).send("No se proporcionaron URLs válidas.");
    }

    // 2️⃣ Crear documento PDF
    const doc = new PDFDocument({ margin: 50 });
    res.setHeader("Content-Disposition", "attachment; filename=reporte.pdf");
    res.setHeader("Content-Type", "application/pdf");
    doc.pipe(res);

    // 3️⃣ Encabezado general
    doc.font("Helvetica-Bold").fontSize(18).text("REPORTE DE TRANSACCIONES", { align: "center" });
    doc.moveDown();

    doc.font("Helvetica-Bold").fontSize(12).text("TESORERO: ", { continued: true });
    doc.font("Helvetica").text("Juan Pablo Barba Medina");
    doc.font("Helvetica-Bold").text("FECHA DEL INFORME: ", { continued: true });
    doc.font("Helvetica").text(dayjs().format("DD/MM/YYYY"));
    doc.moveDown();

    // 4️⃣ Procesar cada CSV
    for (let i = 0; i < csvUrls.length; i++) {
      const url = csvUrls[i];
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Error al descargar: ${url}`);

        const csvText = await response.text();
        const records = parse(csvText, { columns: true, skip_empty_lines: true });
        const data = records[0]; // Segunda fila con datos numéricos

        // Función para formatear números
        const formatNumber = (n) =>
          Number(n).toLocaleString("es-EC", { minimumFractionDigits: 2 });

        const recibidos = formatNumber(data[Object.keys(data)[0]]);
        const entregados = formatNumber(data[Object.keys(data)[1]]);
        const saldo = formatNumber(data[Object.keys(data)[2]]);

        // Sección del archivo
        doc.moveDown(1.5);
        doc.font("Helvetica-Bold").fontSize(14).text(`RESUMEN EJECUTIVO #${i + 1}`);
        doc.font("Helvetica").fontSize(10).fillColor("gray").text(url, { underline: true });
        doc.moveDown(0.5);

        doc.fillColor("black").font("Helvetica").fontSize(12);
        doc.text(`VALORES RECIBIDOS (+): ${recibidos}`);
        doc.text(`VALORES ENTREGADOS (-): ${entregados}`);
        doc.text(`SALDO TOTAL (=): ${saldo}`);

        doc.moveDown();
        doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor("#AAAAAA").stroke(); // línea divisoria
      } catch (err) {
        doc.moveDown();
        doc.fillColor("red").text(`Error al procesar ${url}: ${err.message}`);
        doc.fillColor("black");
      }
    }

    // 5️⃣ Finalizar PDF
    doc.end();
  } catch (error) {
    console.error(error);
    res.status(500).send("Error al generar el PDF");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));
