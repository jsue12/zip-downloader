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
        const json = await csvtojson({ checkType: false }).fromString(text);
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
    const format = n => {
      const num = parseFloat(String(n).replace(/[^\d.-]/g, "")) || 0;
      return num.toLocaleString("es-ES", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
        useGrouping: true
      });
    };
      
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
    
    // Posiciones y anchos de columna (alineadas y contiguas)
    const colX = [50, 80, 270, 340, 410, 480, 550];
    const colW = [30, 190, 70, 70, 70, 70];
    
    // Encabezados con borde
    const headers = ["N°", "ESTUDIANTE", "CUOTAS", "ABONOS", "SALDOS", "ESTADO"];
    doc.font("Helvetica-Bold").fontSize(11).fillColor("black");
    
    let headerY = tableTop;
    
    // Dibujar fondo y bordes de encabezado
    for (let i = 0; i < headers.length; i++) {
      doc.rect(colX[i], headerY, colW[i], rowHeight).fill("#e6e6e6").stroke();
      doc.fillColor("black").text(headers[i], colX[i] + 3, headerY + 5, {
        width: colW[i] - 6,
        align: "center"
      });
    }
    
    // Línea bajo encabezado (termina al final exacto de la última columna)
    const tableRightEdge = colX[colX.length - 1] + colW[colW.length - 1];
    doc.moveTo(colX[0], headerY + rowHeight).lineTo(tableRightEdge, headerY + rowHeight).stroke();
    
    let y = headerY + rowHeight;
    let totalCuotas = 0, totalAbonos = 0, totalSaldos = 0;
    
    // --- Filas de estudiantes ---
    vagueRecords.forEach((r, i) => {
      const keys = Object.keys(r);
      const estudiante = r[keys[0]] ?? "";
      const cuotas = parseFloat(r[keys[1]] || 0);
      const abonos = parseFloat(r[keys[2]] || 0);
      const saldos = parseFloat(r[keys[3]] || 0);
      const estado = (r[keys[keys.length - 1]] || "").toString().toUpperCase();
    
      totalCuotas += cuotas;
      totalAbonos += abonos;
      totalSaldos += saldos;
    
      // Color por estado
      let color = "black";
      if (estado === "POR COBRAR") color = "red";
      else if (estado === "REVISAR") color = "blue";
    
      // Fondo alternado gris claro
      if (i % 2 === 0) {
        doc.save();
        doc.rect(colX[0], y, tableRightEdge - colX[0], rowHeight)
          .fillOpacity(0.05)
          .fill("#d9d9d9")
          .restore();
      }
    
      // Texto con padding
      const pad = 3;
      doc.font("Helvetica").fontSize(10).fillColor(color);
      doc.text(i + 1, colX[0] + pad, y + 5, { width: colW[0] - pad * 2, align: "center" });
      doc.text(estudiante, colX[1] + pad, y + 5, { width: colW[1] - pad * 2, align: "left" });
      doc.text(format(cuotas), colX[2] + pad, y + 5, { width: colW[2] - pad * 2, align: "right" });
      doc.text(format(abonos), colX[3] + pad, y + 5, { width: colW[3] - pad * 2, align: "right" });
      doc.text(format(saldos), colX[4] + pad, y + 5, { width: colW[4] - pad * 2, align: "right" });
      doc.text(estado, colX[5] + pad, y + 5, { width: colW[5] - pad * 2, align: "center" });
    
      // Bordes exactos de celdas
      for (let j = 0; j < headers.length; j++) {
        doc.rect(colX[j], y, colW[j], rowHeight).stroke();
      }
    
      y += rowHeight;
    
      // Salto de página
      if (y > 750) {
        doc.addPage();
        headerY = 50;
    
        // Redibujar encabezado con fondo y borde
        for (let i = 0; i < headers.length; i++) {
          doc.rect(colX[i], headerY, colW[i], rowHeight).fill("#e6e6e6").stroke();
          doc.fillColor("black").text(headers[i], colX[i] + 3, headerY + 5, {
            width: colW[i] - 6,
            align: "center"
          });
        }
    
        doc.moveTo(colX[0], headerY + rowHeight).lineTo(tableRightEdge, headerY + rowHeight).stroke();
        y = headerY + rowHeight;
      }
    });
    
    // Línea antes del total
    doc.moveTo(colX[0], y).lineTo(tableRightEdge, y).stroke();
    
    // Fila total con fondo gris oscuro
    doc.font("Helvetica-Bold").fillColor("white");
    doc.rect(colX[0], y, tableRightEdge - colX[0], rowHeight).fill("#666666");
    const pad = 3;
    
    doc.text("TOTAL GENERAL", colX[1] + pad, y + 5, { width: colW[1] - pad * 2, align: "left" });
    doc.text(format(totalCuotas), colX[2] + pad, y + 5, { width: colW[2] - pad * 2, align: "right" });
    doc.text(format(totalAbonos), colX[3] + pad, y + 5, { width: colW[3] - pad * 2, align: "right" });
    doc.text(format(totalSaldos), colX[4] + pad, y + 5, { width: colW[4] - pad * 2, align: "right" });
    doc.text("-", colX[5] + pad, y + 5, { width: colW[5] - pad * 2, align: "center" });
    
    // Bordes del total
    for (let j = 0; j < headers.length; j++) {
      doc.rect(colX[j], y, colW[j], rowHeight).stroke();
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
