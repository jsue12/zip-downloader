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

    // Descargar y parsear cada CSV (no fallar si uno falla; registramos el error)
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

    // Buscar brawny-letters (case-insensitive)
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

    // Buscar vague-stage
    const vagueEntry = csvDataArr.find(c => c.url.toLowerCase().includes("vague-stage"));
    const vagueRecords = (vagueEntry && vagueEntry.data) ? vagueEntry.data : [];
    // ordenar A-Z por columna keys[0] (estudiante)
    vagueRecords.sort((a, b) => {
      const ka = Object.keys(a)[0];
      const kb = Object.keys(b)[0];
      return String(a[ka] || "").localeCompare(String(b[kb] || ""));
    });

    // --- Crear PDF y enviarlo en stream al cliente ---
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=reporte.pdf");

    const doc = new PDFDocument({ margin: 50 });
    // si ocurre error en doc
    doc.on("error", (err) => {
      console.error("[pdf error]", err);
      if (!res.headersSent) res.status(500).send("Error generando el PDF");
    });
    // Pipe directo (más fiable)
    doc.pipe(res);

    // --- Encabezado ---
    doc.font("Helvetica-Bold").fontSize(18).text("REPORTE DE TRANSACCIONES", { align: "center" });
    doc.moveDown();
    doc.font("Helvetica-Bold").fontSize(12).text("TESORERO:", { continued: true })
      .font("Helvetica").text(" JUAN PABLO BARBA MEDINA");
    doc.font("Helvetica-Bold").text("FECHA DEL INFORME:", { continued: true })
      .font("Helvetica").text(` ${new Date().toLocaleDateString("es-EC")}`);
    doc.moveDown();

    // --- Resumen Ejecutivo (brawny) ---
    doc.font("Helvetica-Bold").fontSize(14).text("RESUMEN EJECUTIVO");
    doc.moveDown(0.5);
    const format = n => Number(n || 0).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    doc.font("Helvetica").fontSize(12);
    doc.text(`VALORES RECIBIDOS (+): ${format(recibidos)}`);
    doc.text(`VALORES ENTREGADOS (-): ${format(entregados)}`);
    doc.font("Helvetica-Bold").text(`SALDO TOTAL (=): ${format(saldo)}`);

    // Línea divisoria
    doc.moveDown().moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown();

    // --- Tabla vague-stage ---
    doc.font("Helvetica-Bold").fontSize(14).text("LISTADO DE ESTUDIANTES");
    doc.moveDown(0.5);

    // Columnas: ESTUDIANTE, CUOTAS, ABONOS, SALDOS, ESTADO
    const tableTop = doc.y;
    const rowHeight = 20;
    const columnPositions = [60, 250, 320, 400, 470];
    const columnWidths = [190, 70, 70, 70, 90];

    const headers = ["ESTUDIANTE", "CUOTAS", "ABONOS", "SALDOS", "ESTADO"];
    doc.font("Helvetica-Bold").fontSize(11).fillColor("black");
    headers.forEach((h, i) => doc.text(h, columnPositions[i], tableTop + 5, { width: columnWidths[i], align: "center" }));

    doc.moveTo(columnPositions[0], tableTop)
      .lineTo(columnPositions[0] + columnWidths.reduce((a, b) => a + b, 0), tableTop)
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

      // color segun estado
      if (estado === "POR COBRAR") doc.fillColor("red");
      else if (estado === "REVISAR") doc.fillColor("blue");
      else doc.fillColor("black");

      doc.font("Helvetica").fontSize(10);

      // fondo alternado
      if (index % 2 === 0) {
        doc.rect(columnPositions[0], y, columnWidths.reduce((a, b) => a + b, 0), rowHeight)
          .fillOpacity(0.04).fill("#d9d9d9").fillOpacity(1);
      }

      // texto celdas (cuotas/abonos/saldos alineados a la derecha)
      doc.fillColor(doc._fillColor || "black"); // asegurar color
      doc.text(estudiante, columnPositions[0], y + 5, { width: columnWidths[0], align: "left" });
      doc.text(format(cuotas), columnPositions[1], y + 5, { width: columnWidths[1], align: "right" });
      doc.text(format(abonos), columnPositions[2], y + 5, { width: columnWidths[2], align: "right" });
      doc.text(format(saldos), columnPositions[3], y + 5, { width: columnWidths[3], align: "right" });
      doc.text(estado, columnPositions[4], y + 5, { width: columnWidths[4], align: "center" });

      // bordes de celdas
      let x = columnPositions[0];
      columnWidths.forEach(width => {
        doc.rect(x, y, width, rowHeight).stroke();
        x += width;
      });

      y += rowHeight;

      // Salto de página con reencabezado
      if (y > 750) {
        doc.addPage();
        const newTop = 50;
        doc.font("Helvetica-Bold").fontSize(11).fillColor("black");
        headers.forEach((h, i) => doc.text(h, columnPositions[i], newTop + 5, { width: columnWidths[i], align: "center" }));
        doc.moveTo(columnPositions[0], newTop)
          .lineTo(columnPositions[0] + columnWidths.reduce((a, b) => a + b, 0), newTop)
          .stroke();
        y = newTop + rowHeight;
      }
    });

    // --- Fila total al final (fondo gris oscuro) ---
    doc.font("Helvetica-Bold").fillColor("black");
    const fullWidth = columnWidths.reduce((a, b) => a + b, 0);
    doc.rect(columnPositions[0], y, fullWidth, rowHeight).fill("#bfbfbf");
    doc.fillColor("black");
    doc.text("TOTAL GENERAL", columnPositions[0], y + 5, { width: columnWidths[0], align: "left" });
    doc.text(format(totalCuotas), columnPositions[1], y + 5, { width: columnWidths[1], align: "right" });
    doc.text(format(totalAbonos), columnPositions[2], y + 5, { width: columnWidths[2], align: "right" });
    doc.text(format(totalSaldos), columnPositions[3], y + 5, { width: columnWidths[3], align: "right" });
    doc.text("-", columnPositions[4], y + 5, { width: columnWidths[4], align: "center" });

    let x = columnPositions[0];
    columnWidths.forEach(width => {
      doc.rect(x, y, width, rowHeight).stroke();
      x += width;
    });

    y += rowHeight;
    doc.moveTo(columnPositions[0], y).lineTo(columnPositions[0] + fullWidth, y).stroke();

    // Finalizar PDF (esto cierra el stream y Render/navegador recibirá el archivo)
    doc.end();
    console.log("[done] PDF stream ended");

  } catch (err) {
    console.error("[catch] error generando PDF:", err?.message || err);
    // Si ya se enviaron headers, no podemos cambiar el status; de lo contrario enviamos texto
    try {
      if (!res.headersSent) res.status(500).send(`Error generando el PDF: ${err?.message || err}`);
    } catch (sendErr) {
      console.error("[secondary error] al enviar la respuesta de error:", sendErr);
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
