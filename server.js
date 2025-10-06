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
      return res.status(400).send("Debes incluir el parámetro 'url' con las URLs de los CSVs separadas por coma.");
    }

    // Obtener URLs
    const csvUrls = urlsParam.split(",").map(u => u.trim()).filter(Boolean);

    // Buscar archivos específicos
    const brawnyUrl = csvUrls.find(u => u.toLowerCase().includes("brawny-letters.csv"));
    const vagueUrl = csvUrls.find(u => u.toLowerCase().includes("vague-stage.csv"));

    if (!brawnyUrl) return res.status(404).send("No se encontró brawny-letters.csv");

    // Crear PDF
    const doc = new PDFDocument({ margin: 50 });
    res.setHeader("Content-Disposition", "attachment; filename=reporte.pdf");
    res.setHeader("Content-Type", "application/pdf");
    doc.pipe(res);

    // --- ENCABEZADO GENERAL ---
    doc.font("Helvetica-Bold").fontSize(18).text("REPORTE DE TRANSACCIONES", { align: "center" });
    doc.moveDown();

    doc.font("Helvetica-Bold").fontSize(12).text("TESORERO: ", { continued: true });
    doc.font("Helvetica").text("Juan Pablo Barba Medina");
    doc.font("Helvetica-Bold").text("FECHA DEL INFORME: ", { continued: true });
    doc.font("Helvetica").text(dayjs().format("DD/MM/YYYY"));
    doc.moveDown();

    // --- RESUMEN EJECUTIVO ---
    const resBrawny = await fetch(brawnyUrl);
    const textBrawny = await resBrawny.text();
    const recordsBrawny = parse(textBrawny, { columns: true, skip_empty_lines: true });
    const dataBrawny = recordsBrawny[0];

    const formatNumber = n => Number(n).toLocaleString("es-EC", { minimumFractionDigits: 2 });

    const recibidos = formatNumber(dataBrawny[Object.keys(dataBrawny)[0]]);
    const entregados = formatNumber(dataBrawny[Object.keys(dataBrawny)[1]]);
    const saldo = formatNumber(dataBrawny[Object.keys(dataBrawny)[2]]);

    doc.font("Helvetica-Bold").fontSize(14).text("RESUMEN EJECUTIVO");
    doc.moveDown();

    doc.font("Helvetica").fontSize(12).text(`VALORES RECIBIDOS (+): ${recibidos}`);
    doc.text(`VALORES ENTREGADOS (-): ${entregados}`);
    doc.moveDown(0.3);
    doc.font("Helvetica-Bold").text(`SALDO TOTAL (=): ${saldo}`);

    // --- LÍNEA DE SEPARACIÓN ---
    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor("#000000").stroke();
    doc.moveDown(1);

    // --- TABLA VAGUE-STAGE ---
    if (vagueUrl) {
      const resVague = await fetch(vagueUrl);
      const textVague = await resVague.text();
      const recordsVague = parse(textVague, { columns: true, skip_empty_lines: true });

      // Ordenar A-Z por nombre de estudiante (segunda columna)
      recordsVague.sort((a, b) => {
        const colA = Object.keys(a)[1];
        const colB = Object.keys(b)[1];
        return a[colA].localeCompare(b[colB]);
      });

      // Encabezados de la tabla
      const headers = ["N°", "ESTUDIANTE", "CUOTAS", "ABONOS", "SALDOS", "ESTADO"];
      const colX = [60, 100, 250, 320, 400, 470]; // posiciones X
      const startY = doc.y;
      doc.font("Helvetica-Bold").fontSize(11);
      headers.forEach((h, i) => doc.text(h, colX[i], startY));

      // Filas
      let y = startY + 20;
      doc.font("Helvetica").fontSize(10);

      recordsVague.forEach((row, index) => {
        const keys = Object.keys(row);
        const estudiante = row[keys[1]];
        const cuotas = row[keys[2]];
        const abonos = row[keys[3]];
        const saldos = row[keys[4]];
        const estado = row[keys[5]];

        // Color según estado
        if (estado?.toUpperCase() === "POR COBRAR") doc.fillColor("red");
        else if (estado?.toUpperCase() === "REVISAR") doc.fillColor("blue");
        else doc.fillColor("black");

        // Escribir fila
        doc.text(index + 1, colX[0], y);
        doc.text(estudiante, colX[1], y);
        doc.text(cuotas, colX[2], y);
        doc.text(abonos, colX[3], y);
        doc.text(saldos, colX[4], y);
        doc.text(estado, colX[5], y);

        y += 18;
        if (y > 750) { doc.addPage(); y = 50; }
      });
    } else {
      doc.font("Helvetica-Oblique").fillColor("red").text("No se encontró el archivo vague-stage.csv");
    }

    // Finalizar PDF
    doc.end();
  } catch (error) {
    console.error(error);
    res.status(500).send("Error al generar el PDF");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));
