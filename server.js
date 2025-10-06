import express from "express";
import fetch from "node-fetch";
import PDFDocument from "pdfkit";
import csv from "csvtojson";

const app = express();

app.get("/generar-reporte", async (req, res) => {
  try {
    const urls = req.query.url?.split(",") || [];
    if (!urls.length) {
      return res.status(400).send("Faltan URLs de archivos CSV");
    }

    const csvData = await Promise.all(urls.map(async (url) => {
      const response = await fetch(url);
      const text = await response.text();
      return csv().fromString(text);
    }));

    // === 1. Datos de brawny-letters.CSV ===
    const brawny = csvData.find((_, i) => urls[i].includes("brawny-letters"));
    const brawnyRow = brawny?.[0] || {};

    const keys = Object.keys(brawnyRow);
    const recibidos = parseFloat(brawnyRow[keys[0]] || 0);
    const entregados = parseFloat(brawnyRow[keys[1]] || 0);
    const saldo = parseFloat(brawnyRow[keys[2]] || 0);

    // === 2. Datos de vague-stage.CSV ===
    const vague = csvData.find((_, i) => urls[i].includes("vague-stage"));
    const vagueRecords = vague ? vague.sort((a, b) => {
      const ka = Object.keys(a)[0];
      const kb = Object.keys(b)[0];
      return a[ka].localeCompare(b[kb]);
    }) : [];

    // === 3. Crear el PDF ===
    const doc = new PDFDocument({ margin: 50 });
    const buffers = [];
    doc.on("data", buffers.push.bind(buffers));
    doc.on("end", () => {
      const pdfData = Buffer.concat(buffers);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", "attachment; filename=reporte.pdf");
      res.send(pdfData);
    });

    // --- Encabezado ---
    doc.font("Helvetica-Bold").fontSize(18).text("REPORTE DE TRANSACCIONES", { align: "center" });
    doc.moveDown();
    doc.font("Helvetica-Bold").fontSize(12).text("TESORERO:", { continued: true })
       .font("Helvetica").text(" JUAN PABLO BARBA MEDINA");
    doc.font("Helvetica-Bold").text("FECHA DEL INFORME:", { continued: true })
       .font("Helvetica").text(` ${new Date().toLocaleDateString("es-EC")}`);
    doc.moveDown();

    // --- Resumen Ejecutivo ---
    doc.font("Helvetica-Bold").fontSize(14).text("RESUMEN EJECUTIVO");
    doc.moveDown(0.5);

    const format = n => n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    doc.font("Helvetica").fontSize(12);
    doc.text(`VALORES RECIBIDOS (+): ${format(recibidos)}`);
    doc.text(`VALORES ENTREGADOS (-): ${format(entregados)}`);

    // saldo en negrita
    doc.font("Helvetica-Bold").text(`SALDO TOTAL (=): ${format(saldo)}`);

    // Línea de separación
    doc.moveDown().moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown();

    // === TABLA vague-stage ===
    doc.font("Helvetica-Bold").fontSize(14).text("LISTADO DE ESTUDIANTES");
    doc.moveDown(0.5);

    const tableTop = doc.y;
    const rowHeight = 20;
    const columnPositions = [60, 250, 320, 400, 470];
    const columnWidths = [190, 70, 70, 70, 90];

    const headers = ["ESTUDIANTE", "CUOTAS", "ABONOS", "SALDOS", "ESTADO"];
    doc.font("Helvetica-Bold").fontSize(11).fillColor("black");
    headers.forEach((header, i) => {
      doc.text(header, columnPositions[i], tableTop + 5, { width: columnWidths[i], align: "center" });
    });

    doc.moveTo(columnPositions[0], tableTop)
       .lineTo(columnPositions[0] + columnWidths.reduce((a, b) => a + b, 0), tableTop)
       .stroke();

    let y = tableTop + rowHeight;

    let totalCuotas = 0, totalAbonos = 0, totalSaldos = 0;
    const f = n => n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    vagueRecords.forEach((row, index) => {
      const keys = Object.keys(row);
      const estudiante = row[keys[0]];
      const cuotas = parseFloat(row[keys[1]] || 0);
      const abonos = parseFloat(row[keys[2]] || 0);
      const saldos = parseFloat(row[keys[3]] || 0);
      const estado = (row[keys[5]] || "").toUpperCase();

      totalCuotas += cuotas;
      totalAbonos += abonos;
      totalSaldos += saldos;

      if (estado === "POR COBRAR") doc.fillColor("red");
      else if (estado === "REVISAR") doc.fillColor("blue");
      else doc.fillColor("black");

      doc.font("Helvetica").fontSize(10);

      // fondo alternado
      if (index % 2 === 0) {
        doc.rect(columnPositions[0], y, columnWidths.reduce((a, b) => a + b, 0), rowHeight)
           .fillOpacity(0.04).fill("#d9d9d9").fillOpacity(1);
      }

      // texto
      doc.text(estudiante, columnPositions[0], y + 5, { width: columnWidths[0], align: "left" });
      doc.text(f(cuotas), columnPositions[1], y + 5, { width: columnWidths[1], align: "right" });
      doc.text(f(abonos), columnPositions[2], y + 5, { width: columnWidths[2], align: "right" });
      doc.text(f(saldos), columnPositions[3], y + 5, { width: columnWidths[3], align: "right" });
      doc.text(estado, columnPositions[4], y + 5, { width: columnWidths[4], align: "center" });

      // bordes
      let x = columnPositions[0];
      columnWidths.forEach(width => {
        doc.rect(x, y, width, rowHeight).stroke();
        x += width;
      });

      y += rowHeight;

      // salto de página
      if (y > 750) {
        doc.addPage();
        const newTop = 50;
        doc.font("Helvetica-Bold").fontSize(11).fillColor("black");
        headers.forEach((header, i) => {
          doc.text(header, columnPositions[i], newTop + 5, { width: columnWidths[i], align: "center" });
        });
        doc.moveTo(columnPositions[0], newTop)
           .lineTo(columnPositions[0] + columnWidths.reduce((a, b) => a + b, 0), newTop)
           .stroke();
        y = newTop + rowHeight;
      }
    });

    // --- Fila total general ---
    doc.font("Helvetica-Bold").fillColor("black");

    // fondo gris oscuro
    doc.rect(columnPositions[0], y, columnWidths.reduce((a, b) => a + b, 0), rowHeight)
       .fill("#bfbfbf");

    doc.fillColor("black");
    doc.text("TOTAL GENERAL", columnPositions[0], y + 5, {
      width: columnWidths[0],
      align: "left"
    });
    doc.text(f(totalCuotas), columnPositions[1], y + 5, { width: columnWidths[1], align: "right" });
    doc.text(f(totalAbonos), columnPositions[2], y + 5, { width: columnWidths[2], align: "right" });
    doc.text(f(totalSaldos), columnPositions[3], y + 5, { width: columnWidths[3], align: "right" });
    doc.text("-", columnPositions[4], y + 5, { width: columnWidths[4], align: "center" });

    let x = columnPositions[0];
    columnWidths.forEach(width => {
      doc.rect(x, y, width, rowHeight).stroke();
      x += width;
    });

    y += rowHeight;
    doc.moveTo(columnPositions[0], y)
       .lineTo(columnPositions[0] + columnWidths.reduce((a, b) => a + b, 0), y)
       .stroke();

    doc.end();

  } catch (error) {
    console.error(error);
    res.status(500).send("Error generando el PDF");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
