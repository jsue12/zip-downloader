import express from "express";
import fetch from "node-fetch";
import PDFDocument from "pdfkit";

const app = express();

app.get("/generar-reporte", async (req, res) => {
  console.log("[start] /generar-reporte request received");
  try {
    const urlsParam = req.query.url;
    if (!urlsParam) {
      return res.status(400).send("Error: Debes incluir el parámetro 'url' con las URLs separadas por comas.");
    }

    const urls = urlsParam.split(",").map(u => u.trim()).filter(Boolean);
    const csvtojson = (await import("csvtojson")).default;

    const csvDataArr = [];
    for (const u of urls) {
      try {
        const resp = await fetch(u);
        if (!resp.ok) continue;
        const text = await resp.text();
        const json = await csvtojson().fromString(text);
        csvDataArr.push({ url: u, data: json });
      } catch (err) {
        console.error(`[error] al descargar/parsear ${u}:`, err?.message);
      }
    }

    const brawnyEntry = csvDataArr.find(c => c.url.toLowerCase().includes("brawny-letters"));
    if (!brawnyEntry || !brawnyEntry.data) {
      return res.status(404).send("No se encontró o no se pudo leer brawny-letters.csv.");
    }

    const brawnyRow = brawnyEntry.data[0] || {};
    const keysB = Object.keys(brawnyRow);
    const recibidos = parseFloat(brawnyRow[keysB[0]] || 0);
    const entregados = parseFloat(brawnyRow[keysB[1]] || 0);
    const saldo = parseFloat(brawnyRow[keysB[2]] || 0);

    const vagueEntry = csvDataArr.find(c => c.url.toLowerCase().includes("vague-stage"));
    const vagueRecords = vagueEntry?.data || [];

    vagueRecords.sort((a, b) => {
      const ka = Object.keys(a)[0];
      const kb = Object.keys(b)[0];
      return String(a[ka] || "").localeCompare(String(b[kb] || ""));
    });

    // --- Crear PDF ---
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=reporte.pdf");
    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res);

    // --- Encabezado ---
    doc.font("Helvetica-Bold").fontSize(18).text("REPORTE DE TRANSACCIONES", { align: "center" });
    doc.moveDown();
    doc.font("Helvetica-Bold").fontSize(12).text("TESORERO:", { continued: true })
      .font("Helvetica").text(" JUAN PABLO BARBA MEDINA");
    doc.font("Helvetica-Bold").text("FECHA DEL INFORME:", { continued: true })
      .font("Helvetica").text(` ${new Date().toLocaleDateString("es-EC")}`);
    doc.moveDown();

    // --- Resumen Ejecutivo ---
    const format = n => Number(n || 0).toLocaleString("es-ES", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    doc.font("Helvetica-Bold").fontSize(14).text("RESUMEN EJECUTIVO");
    doc.moveDown(0.5);
    doc.font("Helvetica").fontSize(12);
    doc.text(`VALORES RECIBIDOS (+): ${format(recibidos)}`);
    doc.text(`VALORES ENTREGADOS (-): ${format(entregados)}`);
    doc.font("Helvetica-Bold").text(`SALDO TOTAL (=): ${format(saldo)}`);
    doc.moveDown().moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown();

    // --- Tabla de estudiantes ---
    doc.font("Helvetica-Bold").fontSize(14).text("LISTADO DE ESTUDIANTES");
    doc.moveDown(0.5);

    const tableTop = doc.y;
    const rowHeight = 20;
    const colX = [50, 80, 270, 340, 420, 500, 570];
    const colW = [30, 190, 70, 70, 70, 70, 0]; // última celda solo para margen

    const headers = ["N°", "ESTUDIANTE", "CUOTAS", "ABONOS", "SALDOS", "ESTADO"];
    doc.font("Helvetica-Bold").fontSize(11).fillColor("black");
    headers.forEach((h, i) => {
      doc.text(h, colX[i], tableTop + 5, { width: colW[i], align: "center" });
    });

    doc.moveTo(colX[0], tableTop + rowHeight)
      .lineTo(colX[5] + colW[5], tableTop + rowHeight)
      .stroke();

    let y = tableTop + rowHeight;
    let totalCuotas = 0, totalAbonos = 0, totalSaldos = 0;

    vagueRecords.forEach((r, i) => {
      const k = Object.keys(r);
      const estudiante = r[k[0]] ?? "";
      const cuotas = parseFloat(r[k[1]] || 0);
      const abonos = parseFloat(r[k[2]] || 0);
      const saldos = parseFloat(r[k[3]] || 0);
      const estado = (r[k[5]] || "").toString().toUpperCase();

      totalCuotas += cuotas;
      totalAbonos += abonos;
      totalSaldos += saldos;

      let color = "black";
      if (estado === "POR COBRAR") color = "red";
      else if (estado === "REVISAR") color = "blue";

      doc.font("Helvetica").fontSize(10).fillColor(color);

      // Fondo alterno
      if (i % 2 === 0) {
        doc.save();
        doc.rect(colX[0], y, colX[5] + colW[5] - colX[0], rowHeight)
          .fillOpacity(0.05)
          .fill("#d9d9d9")
          .restore();
      }

      // Texto de celdas
      doc.text(i + 1, colX[0], y + 5, { width: colW[0], align: "center" });
      doc.text(estudiante, colX[1], y + 5, { width: colW[1], align: "left" });
      doc.text(format(cuotas), colX[2], y + 5, { width: colW[2], align: "right" });
      doc.text(format(abonos), colX[3], y + 5, { width: colW[3], align: "right" });
      doc.text(format(saldos), colX[4], y + 5, { width: colW[4], align: "right" });
      doc.text(estado, colX[5], y + 5, { width: colW[5], align: "center" });

      // Bordes
      for (let j = 0; j < headers.length; j++) {
        doc.rect(colX[j], y, colW[j], rowHeight).stroke();
      }

      y += rowHeight;

      // Salto de página
      if (y > 750) {
        doc.addPage();
        const top = 50;
        doc.font("Helvetica-Bold").fontSize(11).fillColor("black");
        headers.forEach((h, j) => {
          doc.text(h, colX[j], top + 5, { width: colW[j], align: "center" });
        });
        doc.moveTo(colX[0], top + rowHeight)
          .lineTo(colX[5] + colW[5], top + rowHeight)
          .stroke();
        y = top + rowHeight;
      }
    });

    // --- Línea divisoria antes del total ---
    doc.moveTo(colX[0], y).lineTo(colX[5] + colW[5], y).stroke();

    // --- Fila total ---
    doc.font("Helvetica-Bold").fillColor("black");
    const totalY = y;
    doc.rect(colX[0], totalY, colX[5] + colW[5] - colX[0], rowHeight).fill("#bfbfbf");
    doc.fillColor("black");
    doc.text("TOTAL GENERAL", colX[1], totalY + 5, { width: colW[1], align: "left" });
    doc.text(format(totalCuotas), colX[2], totalY + 5, { width: colW[2], align: "right" });
    doc.text(format(totalAbonos), colX[3], totalY + 5, { width: colW[3], align: "right" });
    doc.text(format(totalSaldos), colX[4], totalY + 5, { width: colW[4], align: "right" });
    doc.text("-", colX[5], totalY + 5, { width: colW[5], align: "center" });

    for (let j = 0; j < headers.length; j++) {
      doc.rect(colX[j], totalY, colW[j], rowHeight).stroke();
    }

    doc.end();
    console.log("[done] PDF stream ended");

  } catch (err) {
    console.error("[catch] error generando PDF:", err);
    if (!res.headersSent) res.status(500).send("Error generando el PDF");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
