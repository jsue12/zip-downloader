import express from "express";
import fetch from "node-fetch";
import PDFDocument from "pdfkit";

const app = express();

app.get("/generar-reporte", async (req, res) => {
  console.log("[start] /generar-reporte request received");
  try {
    const urlsParam = req.query.url;
    if (!urlsParam) {
      console.log("[error] missing url param");
      return res.status(400).send("Error: Debes incluir el parámetro 'url' con las URLs separadas por comas.");
    }

    // Separar y limpiar URLs
    const urls = urlsParam.split(",").map(u => u.trim()).filter(Boolean);
    console.log("[info] URLs:", urls);

    // Import dinámico csvtojson (evita ERR_MODULE_NOT_FOUND)
    const csvtojson = (await import("csvtojson")).default;

    // Descargar y parsear cada CSV
    const csvDataArr = [];
    for (const u of urls) {
      try {
        const resp = await fetch(u);
        if (!resp.ok) {
          csvDataArr.push({ url: u, error: `HTTP ${resp.status}` });
          continue;
        }
        const text = await resp.text();
        const json = await csvtojson().fromString(text);
        csvDataArr.push({ url: u, data: json });
      } catch (err) {
        csvDataArr.push({ url: u, error: err?.message || String(err) });
      }
    }

    // Buscar brawny-letters
    const brawnyEntry = csvDataArr.find(c => c.url.toLowerCase().includes("brawny-letters"));
    if (!brawnyEntry || !brawnyEntry.data) {
      return res.status(404).send("No se encontró o no se pudo leer brawny-letters.csv en las URLs proporcionadas.");
    }

    const brawnyRow = brawnyEntry.data[0] || {};
    const keysB = Object.keys(brawnyRow);
    const recibidos = parseFloat(brawnyRow[keysB[0]] || 0);
    const entregados = parseFloat(brawnyRow[keysB[1]] || 0);
    const saldo = parseFloat(brawnyRow[keysB[2]] || 0);

    // Buscar vague-stage
    const vagueEntry = csvDataArr.find(c => c.url.toLowerCase().includes("vague-stage"));
    const vagueRecords = (vagueEntry && vagueEntry.data) ? vagueEntry.data : [];
    vagueRecords.sort((a, b) => {
      const ka = Object.keys(a)[0];
      const kb = Object.keys(b)[0];
      return String(a[ka] || "").localeCompare(String(b[kb] || ""));
    });

    // Crear PDF
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=reporte.pdf");

    const doc = new PDFDocument({ margin: 50, size: "A4" });
    doc.pipe(res);

    // Helpers
    const formatNumber = n => {
      const num = parseFloat(String(n).replace(/[^\d.-]/g, "")) || 0;
      return num.toLocaleString("es-ES", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
        useGrouping: true
      });
    };

    const fillRect = (doc, x, y, w, h, color) => {
      doc.save().rect(x, y, w, h).fill(color).restore();
    };
    const strokeRect = (doc, x, y, w, h) => {
      doc.save().strokeColor("#000").rect(x, y, w, h).stroke().restore();
    };

    // Encabezado
    doc.font("Helvetica-Bold").fontSize(14).text("REPORTE DE TRANSACCIONES", { align: "center" });
    doc.moveDown();
    doc.font("Helvetica-Bold").fontSize(11).text("TESORERO:", { continued: true })
      .font("Helvetica").text(" JUAN PABLO BARBA MEDINA");
    doc.font("Helvetica-Bold").text("FECHA DEL INFORME:", { continued: true })
      .font("Helvetica").text(` ${new Date().toLocaleDateString("es-EC")}`);
    doc.moveDown();

    // Resumen ejecutivo
    doc.font("Helvetica-Bold").fontSize(12).text("RESUMEN EJECUTIVO");
    doc.moveDown(0.5);
    doc.font("Helvetica").fontSize(11);
    doc.text(`VALORES RECIBIDOS (+): ${formatNumber(recibidos)}`);
    doc.text(`VALORES ENTREGADOS (-): ${formatNumber(entregados)}`);
    doc.font("Helvetica-Bold").text(`SALDO TOTAL (=): ${formatNumber(saldo)}`);
    doc.moveDown().moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown();

    // Tabla
    doc.font("Helvetica-Bold").fontSize(12).text("LISTADO DE ESTUDIANTES");
    doc.moveDown(0.5);

    const marginLeft = 50;
    const colWidths = { nro: 41, estudiante: 160, cuotas: 71, abonos: 71, saldos: 71, estado: 81 };
    const columnPositions = [
      marginLeft,
      marginLeft + colWidths.nro,
      marginLeft + colWidths.nro + colWidths.estudiante,
      marginLeft + colWidths.nro + colWidths.estudiante + colWidths.cuotas,
      marginLeft + colWidths.nro + colWidths.estudiante + colWidths.cuotas + colWidths.abonos,
      marginLeft + colWidths.nro + colWidths.estudiante + colWidths.cuotas + colWidths.abonos + colWidths.saldos
    ];
    const rowHeight = 22;

    const headers = ["N°", "ESTUDIANTE", "CUOTAS", "ABONOS", "SALDOS", "ESTADO"];
    const headerY = doc.y;

    for (let i = 0; i < headers.length; i++) {
      fillRect(doc, columnPositions[i], headerY, Object.values(colWidths)[i], rowHeight, "#e6e6e6");
      strokeRect(doc, columnPositions[i], headerY, Object.values(colWidths)[i], rowHeight);
      const textY = headerY + (rowHeight - doc.currentLineHeight()) / 2;
      doc.font("Helvetica-Bold").fontSize(10).fillColor("black");
      doc.text(headers[i], columnPositions[i] + 4, textY, {
        width: Object.values(colWidths)[i] - 8,
        align: "center"
      });
    }

    let y = headerY + rowHeight;
    let totalCuotas = 0, totalAbonos = 0, totalSaldos = 0;

    for (let i = 0; i < vagueRecords.length; i++) {
      const row = vagueRecords[i];
      const keys = Object.keys(row);
      const estudiante = String(row[keys[0]] ?? "");
      const cuotas = parseFloat(row[keys[1]] || 0);
      const abonos = parseFloat(row[keys[2]] || 0);
      const saldos = parseFloat(row[keys[3]] || 0);
      const estado = String(row[keys[5]] ?? "").trim().toUpperCase();

      totalCuotas += cuotas;
      totalAbonos += abonos;
      totalSaldos += saldos;

      if (y + rowHeight > doc.page.height - 60) {
        doc.addPage();
        const newHeaderY = 50;
        for (let j = 0; j < headers.length; j++) {
          fillRect(doc, columnPositions[j], newHeaderY, Object.values(colWidths)[j], rowHeight, "#e6e6e6");
          strokeRect(doc, columnPositions[j], newHeaderY, Object.values(colWidths)[j], rowHeight);
          const headerTextY = newHeaderY + (rowHeight - doc.currentLineHeight()) / 2;
          doc.font("Helvetica-Bold").fontSize(10).fillColor("black");
          doc.text(headers[j], columnPositions[j] + 4, headerTextY, {
            width: Object.values(colWidths)[j] - 8,
            align: "center"
          });
        }
        y = newHeaderY + rowHeight;
      }

      if (i % 2 === 0) fillRect(doc, columnPositions[0], y, Object.values(colWidths).reduce((a, b) => a + b), rowHeight, "#fafafa");

      let cx = columnPositions[0];
      for (let c = 0; c < Object.values(colWidths).length; c++) {
        strokeRect(doc, cx, y, Object.values(colWidths)[c], rowHeight);
        cx += Object.values(colWidths)[c];
      }

      const textY = y + (rowHeight - doc.currentLineHeight()) / 2;
      doc.font("Helvetica").fontSize(10).fillColor("black");
      doc.text(String(i + 1), columnPositions[0] + 3, textY, { width: colWidths.nro - 6, align: "center" });
      doc.text(estudiante, columnPositions[1] + 4, textY, { width: colWidths.estudiante - 8, align: "left" });
      doc.text(formatNumber(cuotas), columnPositions[2] + 3, textY, { width: colWidths.cuotas - 6, align: "right" });
      doc.text(formatNumber(abonos), columnPositions[3] + 3, textY, { width: colWidths.abonos - 6, align: "right" });
      doc.text(formatNumber(saldos), columnPositions[4] + 3, textY, { width: colWidths.saldos - 6, align: "right" });

      if (estado === "POR COBRAR") doc.fillColor("red");
      else if (estado === "REVISAR") doc.fillColor("blue");
      else doc.fillColor("black");
      doc.text(estado, columnPositions[5] + 3, textY, { width: colWidths.estado - 6, align: "center" });
      doc.fillColor("black");

      y += rowHeight;
    }

    if (y + rowHeight > doc.page.height - 60) {
      doc.addPage();
      y = 50;
    }

    const fullTableWidth = Object.values(colWidths).reduce((a, b) => a + b);
    fillRect(doc, columnPositions[0], y, fullTableWidth, rowHeight, "#e6e6e6");
    let tx = columnPositions[0];
    for (let c = 0; c < Object.values(colWidths).length; c++) {
      strokeRect(doc, tx, y, Object.values(colWidths)[c], rowHeight);
      tx += Object.values(colWidths)[c];
    }

    const textYTotal = y + (rowHeight - doc.currentLineHeight()) / 2;
    doc.font("Helvetica-Bold").fontSize(10).fillColor("black");
    const leftSpanWidth = colWidths.nro + colWidths.estudiante;
    doc.text("TOTAL GENERAL", columnPositions[1] + 4, textYTotal, { width: leftSpanWidth - 8, align: "left" });
    doc.text(formatNumber(totalCuotas), columnPositions[2] + 3, textYTotal, { width: colWidths.cuotas - 6, align: "right" });
    doc.text(formatNumber(totalAbonos), columnPositions[3] + 3, textYTotal, { width: colWidths.abonos - 6, align: "right" });
    doc.text(formatNumber(totalSaldos), columnPositions[4] + 3, textYTotal, { width: colWidths.saldos - 6, align: "right" });
    doc.text("-", columnPositions[5] + 3, textYTotal, { width: colWidths.estado - 6, align: "center" });

    doc.moveTo(columnPositions[0], y + rowHeight).lineTo(columnPositions[0] + fullTableWidth, y + rowHeight).stroke();

    doc.moveDown(0.5);
    doc.moveDown().moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown();

    doc.font("Helvetica-Bold").fontSize(12).text("REPORTE DE COBROS", { align: "left" });
    doc.moveDown();

    doc.end();
    console.log("[done] PDF stream ended");

  } catch (err) {
    console.error("[catch] error generando PDF:", err?.message || err);
    if (!res.headersSent) res.status(500).send(`Error generando el PDF: ${err?.message || err}`);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
