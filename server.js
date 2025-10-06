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

    // 1️⃣ Obtener URLs del parámetro
    const csvUrls = urlsParam.split(",").map((u) => u.trim()).filter(Boolean);

    // 2️⃣ Buscar el archivo brawny-letters.csv
    const targetUrl = csvUrls.find((u) => u.toLowerCase().includes("brawny-letters.csv"));
    if (!targetUrl) {
      return res.status(404).send("No se encontró el archivo brawny-letters.csv en las URLs proporcionadas.");
    }

    // 3️⃣ Descargar el CSV objetivo
    const response = await fetch(targetUrl);
    if (!response.ok) throw new Error("No se pudo descargar el archivo brawny-letters.csv");

    const csvText = await response.text();
    const records = parse(csvText, { columns: true, skip_empty_lines: true });
    const data = records[0]; // Segunda fila con los valores

    // 4️⃣ Formatear números
    const formatNumber = (n) =>
      Number(n).toLocaleString("es-EC", { minimumFractionDigits: 2 });

    const recibidos = formatNumber(data[Object.keys(data)[0]]);
    const entregados = formatNumber(data[Object.keys(data)[1]]);
    const saldo = formatNumber(data[Object.keys(data)[2]]);

    // 5️⃣ Crear el PDF
    const doc = new PDFDocument({ margin: 50 });
    res.setHeader("Content-Disposition", "attachment; filename=reporte.pdf");
    res.setHeader("Content-Type", "application/pdf");
    doc.pipe(res);

    // Encabezado
    doc.font("Helvetica-Bold").fontSize(18).text("REPORTE DE TRANSACCIONES", { align: "center" });
    doc.moveDown();

    // Información general
    doc.font("Helvetica-Bold").fontSize(12).text("TESORERO: ", { continued: true });
    doc.font("Helvetica").text("Juan Pablo Barba Medina");
    doc.font("Helvetica-Bold").text("FECHA DEL INFORME: ", { continued: true });
    doc.font("Helvetica").text(dayjs().format("DD/MM/YYYY"));
    doc.moveDown();

    // Sección de resumen
    doc.font("Helvetica-Bold").fontSize(14).text("RESUMEN EJECUTIVO");
    doc.moveDown();

    doc.font("Helvetica").fontSize(12);
    doc.text(`VALORES RECIBIDOS (+): ${recibidos}`);
    doc.text(`VALORES ENTREGADOS (-): ${entregados}`);
    doc.text(`SALDO TOTAL (=): ${saldo}`);

    // Finalizar PDF
    doc.end();
  } catch (error) {
    console.error(error);
    res.status(500).send("Error al generar el PDF");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));
