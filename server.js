import express from "express";
import fs from "fs";
import PDFDocument from "pdfkit";
import csv from "csvtojson";

const app = express();
const port = process.env.PORT || 3000;

// Función para formatear números con separador de miles y 2 decimales
const formatNumber = (num) =>
  isNaN(num) ? "" : Number(num).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Función para dibujar una celda
function drawCell(doc, text, x, y, width, height, align = "left", bold = false, color = "black") {
  doc
    .strokeColor("#000")
    .rect(x, y, width, height)
    .stroke();

  doc
    .fillColor(color)
    .font(bold ? "Helvetica-Bold" : "Helvetica")
    .fontSize(10);

  let textX = x + 5;
  if (align === "right") textX = x + width - 5;
  else if (align === "center") textX = x + width / 2;

  doc.text(text, textX, y + 5, {
    width: width - 10,
    align,
  });
}

app.get("/generar", async (req, res) => {
  try {
    const jsonArray = await csv().fromFile("vague-stage.csv");

    // Ordenar por nombre del estudiante (key 0)
    jsonArray.sort((a, b) => a[0].localeCompare(b[0]));

    // Crear documento PDF
    const doc = new PDFDocument({ margin: 40, size: "A4" });
    const fileName = "Reporte.pdf";
    doc.pipe(fs.createWriteStream(fileName));

    // Título
    doc.font("Helvetica-Bold").fontSize(14).text("REPORTE DE ESTUDIANTES", { align: "center" });
    doc.moveDown(1);

    // Configuración de tabla
    const tableTop = doc.y + 10;
    const colWidths = [40, 150, 80, 80, 80, 90]; // N°, Estudiante, Cuotas, Abonos, Saldos, Estado
    const headers = ["N°", "ESTUDIANTE", "CUOTAS", "ABONOS", "SALDOS", "ESTADO"];

    let x = doc.x;
    let y = tableTop;
    const rowHeight = 20;

    // Dibujar encabezados
    headers.forEach((header, i) => {
      drawCell(doc, header, x, y, colWidths[i], rowHeight, "center", true);
      x += colWidths[i];
    });
    y += rowHeight;

    // Variables de total
    let totalCuotas = 0;
    let totalAbonos = 0;
    let totalSaldos = 0;

    // Dibujar filas
    jsonArray.forEach((row, index) => {
      x = doc.x;
      const estudiante = row[0];
      const cuotas = parseFloat(row[1]) || 0;
      const abonos = parseFloat(row[2]) || 0;
      const saldos = parseFloat(row[3]) || 0;
      const estado = row[5]?.trim().toUpperCase() || "";

      totalCuotas += cuotas;
      totalAbonos += abonos;
      totalSaldos += saldos;

      // Colores según estado
      let color = "black";
      if (estado === "POR COBRAR") color = "red";
      else if (estado === "REVISAR") color = "blue";

      // Saltar de página si necesario
      if (y + rowHeight > doc.page.height - 50) {
        doc.addPage();
        y = 50;
        x = doc.x;
        headers.forEach((header, i) => {
          drawCell(doc, header, x, y, colWidths[i], rowHeight, "center", true);
          x += colWidths[i];
        });
        y += rowHeight;
      }

      // Dibujar cada celda
      drawCell(doc, index + 1, x, y, colWidths[0], rowHeight, "center");
      x += colWidths[0];
      drawCell(doc, estudiante, x, y, colWidths[1], rowHeight);
      x += colWidths[1];
      drawCell(doc, formatNumber(cuotas), x, y, colWidths[2], rowHeight, "right");
      x += colWidths[2];
      drawCell(doc, formatNumber(abonos), x, y, colWidths[3], rowHeight, "right");
      x += colWidths[3];
      drawCell(doc, formatNumber(saldos), x, y, colWidths[4], rowHeight, "right");
      x += colWidths[4];
      drawCell(doc, estado, x, y, colWidths[5], rowHeight, "center", false, color);

      y += rowHeight;
    });

    // Fila de totales
    doc.font("Helvetica-Bold");
    x = doc.x;
    drawCell(doc, "TOTALES", x, y, colWidths[0] + colWidths[1], rowHeight, "right", true);
    x += colWidths[0] + colWidths[1];
    drawCell(doc, formatNumber(totalCuotas), x, y, colWidths[2], rowHeight, "right", true);
    x += colWidths[2];
    drawCell(doc, formatNumber(totalAbonos), x, y, colWidths[3], rowHeight, "right", true);
    x += colWidths[3];
    drawCell(doc, formatNumber(totalSaldos), x, y, colWidths[4], rowHeight, "right", true);
    x += colWidths[4];
    drawCell(doc, "", x, y, colWidths[5], rowHeight, "center");

    doc.end();

    res.send("PDF generado correctamente ✅");
  } catch (error) {
    console.error(error);
    res.status(500).send("Error al generar el PDF");
  }
});

app.listen(port, () => console.log(`Servidor en http://localhost:${port}`));
