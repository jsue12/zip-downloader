import express from "express";
import fetch from "node-fetch";
import { createReadStream } from "fs";
import { parse } from "csv-parse/sync";
import PDFDocument from "pdfkit";
import dayjs from "dayjs";

const app = express();

app.get("/generar-reporte", async (req, res) => {
  try {
    // 1️⃣ Descargar el CSV desde tu dominio
    const csvUrl = "https://zip-downloader.onrender.com/brawny-letters.csv";
    const response = await fetch(csvUrl);
    if (!response.ok) throw new Error("No se pudo descargar el CSV");

    const csvText = await response.text();

    // 2️⃣ Parsear el CSV
    const records = parse(csvText, { columns: true, skip_empty_lines: true });
    const data = records[0]; // Segunda fila (ya que la primera es encabezado)

    // Convertir a número y dar formato
    const formatNumber = (n) =>
      Number(n).toLocaleString("es-EC", { minimumFractionDigits: 2 });

    const recibidos = formatNumber(data[Object.keys(data)[0]]);
    const entregados = formatNumber(data[Object.keys(data)[1]]);
    const saldo = formatNumber(data[Object.keys(data)[2]]);

    // 3️⃣ Crear el PDF
    const doc = new PDFDocument({ margin: 50 });
    res.setHeader("Content-Disposition", "attachment; filename=reporte.pdf");
    res.setHeader("Content-Type", "application/pdf");
    doc.pipe(res);

    // Encabezado
    doc.font("Helvetica-Bold").fontSize(18).text("REPORTE DE TRANSACCIONES", { align: "center" });
    doc.moveDown();

    // Datos generales
    doc.font("Helvetica-Bold").fontSize(12).text("TESORERO: ", { continued: true });
    doc.font("Helvetica").text("Juan Pablo Barba Medina");
    doc.font("Helvetica-Bold").text("FECHA DEL INFORME: ", { continued: true });
    doc.font("Helvetica").text(dayjs().format("DD/MM/YYYY"));
    doc.moveDown();

    // Resumen Ejecutivo
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

// Puerto para Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));
