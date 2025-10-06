import express from "express";
import axios from "axios";
import PDFDocument from "pdfkit";
import dayjs from "dayjs";
import { Readable } from "stream";

const app = express();
const port = process.env.PORT || 3000;

// Función para leer CSV
async function leerCSV(url) {
  const resp = await axios.get(url);
  const lineas = resp.data.trim().split("\n");
  return lineas.map((l) => l.split(","));
}

app.get("/pdf", async (req, res) => {
  try {
    const urls = req.query.url?.split(",") || [];
    if (urls.length === 0) return res.status(400).send("❌ No se proporcionaron URLs de archivos CSV.");

    // Buscar el CSV llamado "brawny-letters.csv"
    const urlBrawny = urls.find((u) => u.includes("brawny-letters.csv"));
    if (!urlBrawny) return res.status(404).send("❌ No se encontró el archivo 'brawny-letters.csv'.");

    // Leer datos del CSV
    const csvData = await leerCSV(urlBrawny);
    const headers = csvData[0];
    const valores = csvData[1].map((v) => parseFloat(v));

    const [valRecibidos, valEntregados, saldoTotal] = valores;

    const formatoNum = (n) =>
      n.toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Crear PDF
    const doc = new PDFDocument({ margin: 50 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=reporte_transacciones.pdf");

    const stream = Readable.from(doc);
    stream.pipe(res);

    // Encabezado
    doc.font("Helvetica-Bold").fontSize(18).text("REPORTE DE TRANSACCIONES", { align: "center" });
    doc.moveDown();

    // Datos principales
    doc.fontSize(12);
    doc.text("TESORERO: ", { continued: true }).font("Helvetica-Bold").text("JUAN PABLO BARBA MEDINA");
    doc.text("FECHA DEL INFORME: ", { continued: true }).font("Helvetica-Bold").text(dayjs().format("DD/MM/YYYY"));
    doc.moveDown();

    // Resumen Ejecutivo
    doc.font("Helvetica-Bold").text("RESUMEN EJECUTIVO");
    doc.moveDown(0.5);
    doc.font("Helvetica").text(`VALORES RECIBIDOS (+): ${formatoNum(valRecibidos)}`);
    doc.text(`VALORES ENTREGADOS (-): ${formatoNum(valEntregados)}`);
    doc.text(`SALDO TOTAL (=): ${formatoNum(saldoTotal)}`);

    doc.end();
  } catch (err) {
    console.error("❌ Error generando PDF:", err.message);
    res.status(500).send("Error generando el PDF.");
  }
});

app.listen(port, () => console.log(`✅ Servidor corriendo en puerto ${port}`));
