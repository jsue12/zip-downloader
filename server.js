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
        console.log(`[fetch] descargando ${u}`);
        const resp = await fetch(u);
        if (!resp.ok) {
          console.warn(`[warn] respuesta no OK (${resp.status}) para ${u}`);
          csvDataArr.push({ url: u, error: `HTTP ${resp.status}` });
          continue;
        }
        const text = await resp.text();
        const json = await csvtojson().fromString(text);
        csvDataArr.push({ url: u, data: json });
        console.log(`[ok] parseado ${u} -> filas: ${json.length}`);
      } catch (err) {
        console.error(`[error] al descargar/parsear ${u}:`, err?.message || err);
        csvDataArr.push({ url: u, error: err?.message || String(err) });
      }
    }

    // Buscar brawny-letters (valores recibidos/entregados/saldo)
    const brawnyEntry = csvDataArr.find(c => c.url.toLowerCase().includes("brawny-letters"));
    if (!brawnyEntry || !brawnyEntry.data) {
      console.log("[error] no se encontró o no se pudo leer brawny-letters.csv");
      return res.status(404).send("No se encontró o no se pudo leer brawny-letters.csv en las URLs proporcionadas.");
    }
    const brawnyRow = brawnyEntry.data[0] || {};
    const keysB = Object.keys(brawnyRow);
    const recibidos = parseFloat(brawnyRow[keysB[0]] || 0);
    const entregados = parseFloat(brawnyRow[keysB[1]] || 0);
    const saldo = parseFloat(brawnyRow[keysB[2]] || 0);

    // Buscar vague-stage (listado de estudiantes)
    const vagueEntry = csvDataArr.find(c => c.url.toLowerCase().includes("vague-stage"));
    const vagueRecords = (vagueEntry && vagueEntry.data) ? vagueEntry.data : [];

    // Ordenar por nombre del estudiante (alfabético)
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
    doc.font("Helvetica-Bold").fontSize(14).text("RESUMEN EJECUTIVO");
    doc.moveDown(0.5);
    const format = n => Number(n || 0).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    doc.font("Helvetica").fontSize(12);
    doc.text(`VALORES RECIBIDOS (+): ${format(recibidos)}`);
    doc.text(`VALORES ENTREGADOS (-): ${format(entregados)}`);
    doc.font("Helvetica-Bold").text(`SALDO TOTAL (=): ${format(saldo)}`);
    doc.moveDown().moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown();

    // --- Tabla: Listado de estudiantes ---
    doc.font("Helvetica-Bold").fontSize(14).text("LISTADO DE ESTUDIANTES");
    doc.moveDown(0.5);

    const tableTop = doc.y;
    const rowHeight = 20;

    // Posiciones y anchos de columnas (con columna N°)
    const columnPositions = [50, 80, 270, 340, 420, 500];
    const columnWidths = [30, 190, 70, 70, 70, 70];
    const headers = ["N°", "ESTUDIANTE", "CUOTAS", "ABONOS", "SALDOS", "ESTADO"];

    // Dibujar encabezados
    doc.font("Helvetica-Bold").fontSize(11).fillColor("black");
    headers.forEach((h, i) => {
      doc.text(h, columnPositions[i], tableTop + 5, { width: columnWidths[i], align: "center" });
    });
    doc.moveTo(columnPositions[0], tableTop + rowHeight)
      .lineTo(columnPositions[0] + columnWidths.reduce((a, b) => a + b, 0), tableTop + rowHeight)
      .stroke();

    let y = tableTop + rowHeight;
    let totalCuotas = 0, totalAbonos = 0, totalSaldos = 0;

    vagueRecords.forEach((row, index) => {
      const keys = Object.keys(row);
      const estudiante = row[keys[0]] ?? "";
      const cuotas = parseFloat(row[keys[1]] || 0);
      const abonos = parseFloat(row[keys[2]] || 0);
      const saldos = parseFloat(row[keys[3]] || 0);
      const estado = (row[keys[5]] || "").toString().toUpperCase();

      totalCuotas += cuotas;
      totalAbonos += abonos;
      totalSaldos += saldos;

      // Color por estado
      if (estado === "POR COBRAR") doc.fillColor("red");
      else if (estado === "REVISAR") doc.fillColor("blue");
      else doc.fillColor("black");

      doc.font("Helvetica").fontSize(10);

      // Fondo alternado (gris suave)
      if (index % 2 === 0) {
        doc.rect(columnPositions[0], y, columnWidths.reduce((a, b) => a + b, 0), rowHeight)
          .fillOpacity(0.05).fill("#d9d9d9").fillOpacity(1);
      }

      // Texto de cada celda
      doc.text(index + 1, columnPositions[0], y + 5, { width: columnWidths[0], align: "center" });
      doc.text(estudiante, columnPositions[1], y + 5, { width: columnWidths[1], align: "left" });
      doc.text(format(cuotas), columnPositions[2], y + 5, { width: columnWidths[2], align: "right" });
      doc.text(format(abonos), columnPositions[3], y + 5, { width: columnWidths[3], align: "right" });
      doc.text(format(saldos), columnPositions[4], y + 5, { width: columnWidths[4], align: "right" });
      doc.text(estado, columnPositions[5], y + 5, { width: columnWidths[5], align: "center" });

      // Bordes
      let x = columnPositions[0];
      columnWidths.forEach(width => {
        doc.rect(x, y, width, rowHeight).stroke();
        x += width;
      });

      y += rowHeight;

      // Salto de página con encabezados reimpresos
      if (y > 750) {
        doc.addPage();
        const newTop = 50;
        doc.font("Helvetica-Bold").fontSize(11).fillColor("black");
        headers.forEach((h, i) => {
          doc.text(h, columnPositions[i], newTop + 5, { width: columnWidths[i], align: "center" });
        });
        doc.moveTo(columnPositions[0], newTop + rowHeight)
          .lineTo(columnPositions[0] + columnWidths.reduce((a, b) => a + b, 0), newTop + rowHeight)
          .stroke();
        y = newTop + rowHeight;
      }
    });

    // --- Fila Total ---
    doc.font("Helvetica-Bold").fillColor("black");
    const fullWidth = columnWidths.reduce((a, b) => a + b, 0);
    doc.rect(columnPositions[0], y, fullWidth, rowHeight).fill("#bfbfbf");
    doc.fillColor("black");
    doc.text("TOTAL GENERAL", columnPositions[1], y + 5, { width: columnWidths[1], align: "left" });
    doc.text(format(totalCuotas), columnPositions[2], y + 5, { width: columnWidths[2], align: "right" });
    doc.text(format(totalAbonos), columnPositions[3], y + 5, { width: columnWidths[3], align: "right" });
    doc.text(format(totalSaldos), columnPositions[4], y + 5, { width: columnWidths[4], align: "right" });
    doc.text("-", columnPositions[5], y + 5, { width: columnWidths[5], align: "center" });

    let x = columnPositions[0];
    columnWidths.forEach(width => {
      doc.rect(x, y, width, rowHeight).stroke();
      x += width;
    });

    y += rowHeight;
    doc.moveTo(columnPositions[0], y).lineTo(columnPositions[0] + fullWidth, y).stroke();

    // --- Finalizar PDF ---
    doc.end();
    console.log("[done] PDF stream ended");

  } catch (err) {
    console.error("[catch] error generando PDF:", err?.message || err);
    if (!res.headersSent)
      res.status(500).send(`Error generando el PDF: ${err?.message || err}`);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
