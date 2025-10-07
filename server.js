import express from "express";
import PDFDocument from "pdfkit";
import csvtojson from "csvtojson";

const app = express();

app.get("/generar-reporte", async (req, res) => {
  console.log("[start] /generar-reporte request received");

  try {
    const urlsParam = req.query.url;
    if (!urlsParam) {
      return res.status(400).send("Error: Debes incluir el parámetro 'url' con las URLs separadas por comas.");
    }

    const urls = urlsParam.split(",").map(u => u.trim()).filter(Boolean);

    // ✅ Node 18+ ya tiene fetch incorporado
    const csvDataArr = [];
    for (const u of urls) {
      try {
        const resp = await fetch(u);
        if (!resp.ok) {
          console.warn("No se pudo leer:", u);
          continue;
        }
        const text = await resp.text();
        const json = await csvtojson().fromString(text);
        csvDataArr.push({ url: u, data: json });
      } catch (err) {
        console.error("Error cargando:", u, err);
      }
    }

    // =============================
    // ARCHIVO brawny-letters
    // =============================
    const brawnyEntry = csvDataArr.find(c => c.url.toLowerCase().includes("brawny-letters"));
    if (!brawnyEntry || !brawnyEntry.data) {
      return res.status(404).send("No se encontró o no se pudo leer brawny-letters.csv");
    }

    const brawnyRow = brawnyEntry.data[0] || {};
    const keysB = Object.keys(brawnyRow);
    const recibidos = parseFloat(brawnyRow[keysB[0]] || 0);
    const entregados = parseFloat(brawnyRow[keysB[1]] || 0);
    const saldo = parseFloat(brawnyRow[keysB[2]] || 0);

    // =============================
    // ARCHIVO vague-stage
    // =============================
    const vagueEntry = csvDataArr.find(c => c.url.toLowerCase().includes("vague-stage"));
    const vagueRecords = vagueEntry?.data || [];
    vagueRecords.sort((a, b) => {
      const ka = Object.keys(a)[0];
      const kb = Object.keys(b)[0];
      return String(a[ka] || "").localeCompare(String(b[kb] || ""));
    });

    // =============================
    // ARCHIVO telling-match
    // =============================
    const tellingEntry = csvDataArr.find(c => c.url.toLowerCase().includes("telling-match"));
    const tellingRecords = tellingEntry?.data || [];
    tellingRecords.sort((a, b) => {
      const fechaA = new Date(a["Fecha"] || a["fecha"] || "");
      const fechaB = new Date(b["Fecha"] || b["fecha"] || "");
      return fechaA - fechaB;
    });

    // =============================
    // CREAR PDF
    // =============================
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=reporte.pdf");

    const doc = new PDFDocument({ margin: 50, size: "A4" });
    doc.pipe(res);

    const formatNumber = n => {
      const num = parseFloat(String(n).replace(/[^\d.-]/g, "")) || 0;
      return num.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };
    const fillRect = (d, x, y, w, h, c) => d.save().rect(x, y, w, h).fill(c).restore();
    const strokeRect = (d, x, y, w, h) => d.save().strokeColor("#000").rect(x, y, w, h).stroke().restore();

    // Encabezado
    doc.font("Helvetica-Bold").fontSize(14).text("REPORTE DE TRANSACCIONES", { align: "center" });
    doc.moveDown();
    doc.font("Helvetica-Bold").fontSize(11).text("TESORERO:", { continued: true })
      .font("Helvetica").text(" JUAN PABLO BARBA MEDINA");
    doc.font("Helvetica-Bold").text("FECHA DEL INFORME:", { continued: true })
      .font("Helvetica").text(` ${new Date().toLocaleDateString("es-EC")}`);
    doc.moveDown();

    // =============================
    // RESUMEN EJECUTIVO
    // =============================
    doc.font("Helvetica-Bold").fontSize(12).text("RESUMEN EJECUTIVO");
    doc.moveDown(0.5);
    doc.font("Helvetica").fontSize(11);
    doc.text(`VALORES RECIBIDOS (+): ${formatNumber(recibidos)}`);
    doc.text(`VALORES ENTREGADOS (-): ${formatNumber(entregados)}`);
    doc.font("Helvetica-Bold").text(`SALDO TOTAL (=): ${formatNumber(saldo)}`);
    doc.moveDown().moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown();

    // =============================
    // TABLA DE VAGUE-STAGE
    // =============================
    doc.font("Helvetica-Bold").fontSize(12).text("LISTADO DE ESTUDIANTES");
    doc.moveDown(0.5);

    const marginLeft = 50;
    const colWidths = { nro: 35, estudiante: 162, cuotas: 72, abonos: 72, saldos: 72, estado: 82 };
    const columns = Object.values(colWidths);
    const positions = columns.reduce((acc, w, i) => {
      acc.push((acc[i - 1] ?? marginLeft) + (i ? columns[i - 1] : 0));
      return acc;
    }, []);
    const rowHeight = 22;
    const headers = ["N°", "ESTUDIANTE", "CUOTAS", "ABONOS", "SALDOS", "ESTADO"];

    const drawHeaders = (yPos) => {
      headers.forEach((h, i) => {
        fillRect(doc, positions[i], yPos, columns[i], rowHeight, "#e6e6e6");
        strokeRect(doc, positions[i], yPos, columns[i], rowHeight);
        doc.font("Helvetica-Bold").fontSize(10).fillColor("black")
          .text(h, positions[i] + 4, yPos + 6, { width: columns[i] - 8, align: "center" });
      });
    };

    let y = doc.y;
    drawHeaders(y);
    y += rowHeight;
    let totalCuotas = 0, totalAbonos = 0, totalSaldos = 0;

    vagueRecords.forEach((row, i) => {
      const keys = Object.keys(row);
      const estudiante = String(row[keys[0]] ?? "");
      const cuotas = parseFloat(row[keys[1]] || 0);
      const abonos = parseFloat(row[keys[2]] || 0);
      const saldos = parseFloat(row[keys[3]] || 0);
      const estado = String(row[keys[5]] ?? "").trim().toUpperCase();

      totalCuotas += cuotas; totalAbonos += abonos; totalSaldos += saldos;
      if (y + rowHeight > doc.page.height - 60) { doc.addPage(); y = 50; drawHeaders(y); y += rowHeight; }
      if (i % 2 === 0) fillRect(doc, positions[0], y, columns.reduce((a, b) => a + b), rowHeight, "#fafafa");

      let x = positions[0];
      columns.forEach((cw) => { strokeRect(doc, x, y, cw, rowHeight); x += cw; });

      const textY = y + 6;
      doc.font("Helvetica").fontSize(10).fillColor("black");
      doc.text(String(i + 1), positions[0] + 3, textY, { width: columns[0] - 6, align: "center" });
      doc.text(estudiante, positions[1] + 4, textY, { width: columns[1] - 8, align: "left" });
      doc.text(formatNumber(cuotas), positions[2] + 3, textY, { width: columns[2] - 6, align: "right" });
      doc.text(formatNumber(abonos), positions[3] + 3, textY, { width: columns[3] - 6, align: "right" });
      doc.text(formatNumber(saldos), positions[4] + 3, textY, { width: columns[4] - 6, align: "right" });

      doc.fillColor(estado === "POR COBRAR" ? "red" : estado === "REVISAR" ? "blue" : "black");
      doc.text(estado, positions[5] + 3, textY, { width: columns[5] - 6, align: "center" });
      y += rowHeight;
    });

    // Totales
    if (y + rowHeight > doc.page.height - 60) { doc.addPage(); y = 50; }
    fillRect(doc, positions[0], y, columns.reduce((a, b) => a + b), rowHeight, "#e6e6e6");
    let tx = positions[0];
    columns.forEach((cw) => { strokeRect(doc, tx, y, cw, rowHeight); tx += cw; });
    doc.font("Helvetica-Bold").fontSize(10).fillColor("black");
    doc.text("TOTAL GENERAL", positions[1] + 4, y + 6, { width: columns[1] - 8, align: "left" });
    doc.text(formatNumber(totalCuotas), positions[2] + 3, y + 6, { width: columns[2] - 6, align: "right" });
    doc.text(formatNumber(totalAbonos), positions[3] + 3, y + 6, { width: columns[3] - 6, align: "right" });
    doc.text(formatNumber(totalSaldos), positions[4] + 3, y + 6, { width: columns[4] - 6, align: "right" });
    doc.text("", positions[5] + 3, y + 6, { width: columns[5] - 6, align: "center" });
    doc.moveDown(2);

    // =============================
    // TABLA DE TELLING-MATCH
    // =============================
    doc.font("Helvetica-Bold").fontSize(12);
    doc.text("TRANSACCIONES DE COBRO", 50, doc.y, { align: "left", width: 500 });
    doc.moveDown(1);

    const tMargin = 50;
    const tRowH = 22;
    const tCols = { n: 35, fecha: 72, estudiante: 135, banco: 98, comprobante: 90, valor: 65 };
    const tPos = [
      tMargin,
      tMargin + tCols.n,
      tMargin + tCols.n + tCols.fecha,
      tMargin + tCols.n + tCols.fecha + tCols.estudiante,
      tMargin + tCols.n + tCols.fecha + tCols.estudiante + tCols.banco,
      tMargin + tCols.n + tCols.fecha + tCols.estudiante + tCols.banco + tCols.comprobante
    ];
    const tHeaders = ["N°", "FECHA", "ESTUDIANTE", "BANCO", "# COMPROBANTE", "VALOR"];
    let ty = doc.y;

    const drawTellingHeaders = (yPos) => {
      tHeaders.forEach((h, i) => {
        fillRect(doc, tPos[i], yPos, Object.values(tCols)[i], tRowH, "#e6e6e6");
        strokeRect(doc, tPos[i], yPos, Object.values(tCols)[i], tRowH);
        doc.font("Helvetica-Bold").fontSize(9).fillColor("black")
          .text(h, tPos[i] + 4, yPos + 6, { width: Object.values(tCols)[i] - 8, align: "center" });
      });
    };

    drawTellingHeaders(ty);
    ty += tRowH;

    let totalValor = 0;
    const tellingMatrix = tellingRecords.map(obj => Object.values(obj));
    
    tellingMatrix.forEach((row, i) => {
      // Acceder por índice según orden de columnas
      const fechaRaw = String(row[0] || "");
      const estudiante = String(row[1] || "").trim();
      const banco = String(row[2] || "").trim();
      const comp = String(row[4] || "");
      const valora = parseFloat(String(row[3]).replace(/[^\d.-]/g, "")) || 0;
      totalValor += valora;
    
      // Formatear fecha si es válida
      const fechaObj = new Date(fechaRaw);
      const fecha = isNaN(fechaObj)
        ? fechaRaw
        : `${String(fechaObj.getDate()).padStart(2, "0")}-${String(fechaObj.getMonth() + 1).padStart(2, "0")}-${fechaObj.getFullYear()}`;
    
      // Salto de página si es necesario
      if (ty + tRowH > doc.page.height - 60) {
        doc.addPage();
        ty = 50;
        drawTellingHeaders(ty);
        ty += tRowH;
      }
    
      // Fondo alterno
      if (i % 2 === 0) fillRect(doc, tPos[0], ty, 495, tRowH, "#fafafa");
    
      // Bordes de fila
      let tx2 = tPos[0];
      Object.values(tCols).forEach((cw) => { strokeRect(doc, tx2, ty, cw, tRowH); tx2 += cw; });
    
      // Texto en celdas
      const tTextY = ty + 6;
      doc.font("Helvetica").fontSize(9).fillColor("black");
      doc.text(String(i + 1), tPos[0] + 3, tTextY, { width: tCols.n - 6, align: "center" });
      doc.text(fecha, tPos[1] + 3, tTextY, { width: tCols.fecha - 6, align: "center" });
      doc.text(estudiante, tPos[2] + 4, tTextY, { width: tCols.estudiante - 8, align: "left" });
      doc.text(banco, tPos[3] + 4, tTextY, { width: tCols.banco - 8, align: "left" });
      doc.text(comp, tPos[4] + 4, tTextY, { width: tCols.comprobante - 8, align: "center" });
      doc.text(formatNumber(valora), tPos[5] + 3, tTextY, { width: tCols.valor - 6, align: "right" });
    
      ty += tRowH;
    });
    
    // ===================
    // TOTAL FINAL
    // ===================
    if (ty + tRowH > doc.page.height - 60) { doc.addPage(); ty = 50; }
    fillRect(doc, tPos[0], ty, 495, tRowH, "#e6e6e6");
    Object.values(tCols).reduce((x, w) => {
      strokeRect(doc, x, ty, w, tRowH);
      return x + w;
    }, tPos[0]);
    doc.font("Helvetica-Bold").fontSize(9).fillColor("black");
    doc.text("TOTAL", tPos[0] + 4, ty + 6, { width: 495 - tCols.valor - 8, align: "right" });
    doc.text(formatNumber(totalValor), tPos[5] + 3, ty + 6, { width: tCols.valor - 6, align: "right" });

    // Finalizar PDF
    doc.end();
    console.log("[done] PDF stream ended ✅");
  } catch (err) {
    console.error("Error generando PDF:", err);
    if (!res.headersSent) res.status(500).send(err.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
