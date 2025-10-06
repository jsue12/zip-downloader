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

    // Obtener URLs desde el parámetro
    const csvUrls = urlsParam.split(",").map((u) => u.trim()).filter(Boolean);

    // Buscar los archivos requeridos
    const brawnyUrl = csvUrls.find((u) => u.toLowerCase().includes("brawny-letters.csv"));
    const vagueUrl = csvUrls.find((u) => u.toLowerCase().includes("vague-stage.csv"));

    if (!brawnyUrl) {
      return res.status(404).send("No se encontró el archivo brawny-letters.csv en las URLs proporcionadas.");
    }

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

    // --- RESUMEN EJECUTIVO (brawny-letters) ---
    const brawnyRes = await fetch(brawnyUrl);
    if (!brawnyRes.ok) throw new Error("No se pudo descargar brawny-letters.csv");

    const brawnyText = await brawnyRes.text();
    const brawnyRecords = parse(brawnyText, { columns: true, skip_empty_lines: true });
    const brawnyData = brawnyRecords[0];

    const formatNumber = (n) =>
      Number(n).toLocaleString("es-EC", { minimumFractionDigits: 2 });

    const recibidos = formatNumber(brawnyData[Object.keys(brawnyData)[0]]);
    const entregados = formatNumber(brawnyData[Object.keys(brawnyData)[1]]);
    const saldo = formatNumber(brawnyData[Object.keys(brawnyData)[2]]);

    // Título sección
    doc.font("Helvetica-Bold").fontSize(14).text("RESUMEN EJECUTIVO");
    doc.moveDown();

    doc.font("Helvetica").fontSize(12);
    doc.text(`VALORES RECIBIDOS (+): ${recibidos}`);
    doc.text(`VALORES ENTREGADOS (-): ${entregados}`);
    doc.moveDown(0.3);
    doc.font("Helvetica-Bold").text("SALDO TOTAL (=): ", { continued: true });
    doc.text(saldo);

    // Línea divisoria
    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor("#000000").stroke();
    doc.moveDown(1);

    // --- TABLA (vague-stage.csv) ---
    if (!vagueUrl) {
      doc.font("Helvetica-Oblique").fontSize(11).fillColor("red")
        .text("No se encontró el archivo vague-stage.csv. No se generó la tabla de estudiantes.");
    } else {
      const vagueRes = await fetch(vagueUrl);
      if (!vagueRes.ok) throw new Error("No se pudo descargar el resumen por estudiante");
      const vagueText = await vagueRes.text();
      const vagueRecords = parse(vagueText, { columns: true, skip_empty_lines: true });

      // Ordenar A-Z por nombre de estudiante (segunda columna)
      vagueRecords.sort((a, b) => {
        const colNameA = Object.keys(a)[1];
        const colNameB = Object.keys(b)[1];
        return a[colNameA].localeCompare(b[colNameB]);
      });

      // Encabezado tabla
      doc.moveDown();
      doc.font("Helvetica-Bold").fontSize(14).text("RESUMEN POR ESTUDIANTE");
      doc.moveDown(0.5);

      const tableTop = doc.y;
      const columnPositions = [60, 100, 250, 320, 400, 470]; // posiciones X de las columnas

      // Encabezados
      doc.font("Helvetica-Bold").fontSize(11);
      const headers = ["N°", "ESTUDIANTE", "CUOTAS", "ABONOS", "SALDOS", "ESTADO"];
      headers.forEach((header, i) => {
        doc.text(header, columnPositions[i], tableTop);
      });

      // Filas
      let y = tableTop + 20;
      doc..font("Helvetica").fontSize(10);

      vagueRecords.forEach((row, index) => {
        const keys = Object.keys(row);
        const estudiante = row[keys[0]];
        const cuotas = row[keys[1]];
        const abonos = row[keys[2]];
        const saldos = row[keys[3]];
        const estado = row[keys[5]];

        // Color según estado
        if (estado?.toUpperCase() === "POR COBRAR") {
          doc.fillColor("red");
        } else if (estado?.toUpperCase() === "REVISAR") {
          doc.fillColor("blue");
        } else {
          doc.fillColor("black");
        }

        // Imprimir fila
        doc.text(index + 1, columnPositions[0], y);
        doc.text(estudiante, columnPositions[1], y);
        doc.text(cuotas, columnPositions[2], y);
        doc.text(abonos, columnPositions[3], y);
        doc.text(saldos, columnPositions[4], y);
        doc.text(estado, columnPositions[5], y);

        y += 18;

        // Salto de página si se sale del límite
        if (y > 750) {
          doc.addPage();
          y = 50;
        }
      });
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
