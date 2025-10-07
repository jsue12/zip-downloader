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

    const doc = new PDFDocument({ margin: 50, size: "A4" });
    doc.on("error", (err) => {
      console.error("[pdf error]", err);
      if (!res.headersSent) res.status(500).send("Error generando el PDF");
    });
    doc.pipe(res);

    // --- Helpers ---
    const formatNumber = n => Number(n || 0).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Dibuja rect (relleno + borde) sin afectar el color del texto posterior
    function fillRect(doc, x, y, w, h, fillColor) {
      doc.save();
      doc.rect(x, y, w, h).fill(fillColor);
      doc.restore();
    }

    // Dibuja borde (sin rellenar)
    function strokeRect(doc, x, y, w, h) {
      doc.save();
      doc.strokeColor("#000").rect(x, y, w, h).stroke();
      doc.restore();
    }

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
    const format = formatNumber;

    doc.font("Helvetica").fontSize(12);
    doc.text(`VALORES RECIBIDOS (+): ${format(recibidos)}`);
    doc.text(`VALORES ENTREGADOS (-): ${format(entregados)}`);
    doc.font("Helvetica-Bold").text(`SALDO TOTAL (=): ${format(saldo)}`);

    // Línea divisoria
    doc.moveDown().moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown();

    // --- Tabla vague-stage ---
    doc.font("Helvetica-Bold").fontSize(14).text("LISTADO DE ESTUDIANTES");
    doc.moveDown(0.5);

    // Definir columnas (incluye N°)
    const marginLeft = 50;
    const colWidths = {
      nro: 40,
      estudiante: 200,
      cuotas: 60,
      abonos: 60,
      saldos: 60,
      estado: 55
    };
    // calcular posiciones X
    const columnPositions = [
      marginLeft,
      marginLeft + colWidths.nro,
      marginLeft + colWidths.nro + colWidths.estudiante,
      marginLeft + colWidths.nro + colWidths.estudiante + colWidths.cuotas,
      marginLeft + colWidths.nro + colWidths.estudiante + colWidths.cuotas + colWidths.abonos,
      marginLeft + colWidths.nro + colWidths.estudiante + colWidths.cuotas + colWidths.abonos + colWidths.saldos
    ];
    const rowHeight = 22;

    // Encabezados dentro de los bordes (fondo gris claro)
    const headers = ["N°", "ESTUDIANTE", "CUOTAS", "ABONOS", "SALDOS", "ESTADO"];
    const headerX = columnPositions;
    const headerWidths = [colWidths.nro, colWidths.estudiante, colWidths.cuotas, colWidths.abonos, colWidths.saldos, colWidths.estado];
    const headerY = doc.y;

    // Dibujar encabezados (fondo + borde + texto en negrita)
    for (let i = 0; i < headers.length; i++) {
      fillRect(doc, headerX[i], headerY, headerWidths[i], rowHeight, "#e6e6e6");
      strokeRect(doc, headerX[i], headerY, headerWidths[i], rowHeight);
      doc.font("Helvetica-Bold").fontSize(10).fillColor("black");
      doc.text(headers[i], headerX[i] + 4, headerY + 6, { width: headerWidths[i] - 8, align: "center" });
    }

    let y = headerY + rowHeight;

    // Totales acumuladores
    let totalCuotas = 0;
    let totalAbonos = 0;
    let totalSaldos = 0;

    // Iterar filas
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

      // Si se va a pasar del bottom, agregar página y re-dibujar encabezados
      if (y + rowHeight > doc.page.height - 60) {
        doc.addPage();
        // re-dibujar encabezados en nueva página
        for (let j = 0; j < headers.length; j++) {
          fillRect(doc, headerX[j], 50, headerWidths[j], rowHeight, "#e6e6e6");
          strokeRect(doc, headerX[j], 50, headerWidths[j], rowHeight);
          doc.font("Helvetica-Bold").fontSize(10).fillColor("black");
          doc.text(headers[j], headerX[j] + 4, 50 + 6, { width: headerWidths[j] - 8, align: "center" });
        }
        y = 50 + rowHeight;
      }

      // fondo alternado muy suave (no afecta color del texto)
      if (i % 2 === 0) {
        fillRect(doc, columnPositions[0], y, headerWidths.reduce((a, b) => a + b, 0), rowHeight, "#fafafa");
        // no stroke aquí para evitar doble línea; las líneas se dibujarán abajo
      }

      // Dibujar bordes celda por celda (para mantener los rectángulos separados)
      let cx = columnPositions[0];
      const cellWidths = headerWidths;
      for (let c = 0; c < cellWidths.length; c++) {
        strokeRect(doc, cx, y, cellWidths[c], rowHeight);
        cx += cellWidths[c];
      }

      // Texto en celdas: todo negro por defecto
      doc.font("Helvetica").fontSize(10).fillColor("black");

      // N°
      doc.text(String(i + 1), columnPositions[0] + 3, y + 6, { width: cellWidths[0] - 6, align: "center" });

      // Estudiante (izquierda)
      doc.text(estudiante, columnPositions[1] + 4, y + 6, { width: cellWidths[1] - 8, align: "left" });

      // Cuotas - derecha (formateado)
      doc.text(formatNumber(cuotas), columnPositions[2] + 3, y + 6, { width: cellWidths[2] - 6, align: "right" });

      // Abonos - derecha
      doc.text(formatNumber(abonos), columnPositions[3] + 3, y + 6, { width: cellWidths[3] - 6, align: "right" });

      // Saldos - derecha
      doc.text(formatNumber(saldos), columnPositions[4] + 3, y + 6, { width: cellWidths[4] - 6, align: "right" });

      // Estado: color solo para este texto
      if (estado === "POR COBRAR") doc.fillColor("red");
      else if (estado === "REVISAR") doc.fillColor("blue");
      else doc.fillColor("black");
      doc.text(estado, columnPositions[5] + 3, y + 6, { width: cellWidths[5] - 6, align: "center" });

      // Asegurar volver a negro para la siguiente fila
      doc.fillColor("black");

      y += rowHeight;
    }

    // -- Fila de totales (solo al final) --
    // Aseguramos espacio de página; si no hay, agregamos nueva página
    if (y + rowHeight > doc.page.height - 60) {
      doc.addPage();
      // re-dibujar encabezados
      for (let j = 0; j < headers.length; j++) {
        fillRect(doc, headerX[j], 50, headerWidths[j], rowHeight, "#e6e6e6");
        strokeRect(doc, headerX[j], 50, headerWidths[j], rowHeight);
        doc.font("Helvetica-Bold").fontSize(10).fillColor("black");
        doc.text(headers[j], headerX[j] + 4, 50 + 6, { width: headerWidths[j] - 8, align: "center" });
      }
      y = 50 + rowHeight;
    }

    // fondo gris oscuro para totales (entero ancho de tabla)
    const fullTableWidth = headerWidths.reduce((a, b) => a + b, 0);
    fillRect(doc, columnPositions[0], y, fullTableWidth, rowHeight, "#bfbfbf");
    // bordes de la fila total
    let tx = columnPositions[0];
    for (let c = 0; c < headerWidths.length; c++) {
      strokeRect(doc, tx, y, headerWidths[c], rowHeight);
      tx += headerWidths[c];
    }

    // Texto de totales en negrita y negro
    doc.font("Helvetica-Bold").fontSize(10).fillColor("black");
    // "TOTAL GENERAL" en columna Estudiante (ocupando N° + Estudiante ancho)
    const leftSpanWidth = headerWidths[0] + headerWidths[1];
    doc.text("TOTAL GENERAL", columnPositions[0] + 4, y + 6, { width: leftSpanWidth - 8, align: "left" });

    // Totales numéricos alineados a la derecha
    doc.text(formatNumber(totalCuotas), columnPositions[2] + 3, y + 6, { width: headerWidths[2] - 6, align: "right" });
    doc.text(formatNumber(totalAbonos), columnPositions[3] + 3, y + 6, { width: headerWidths[3] - 6, align: "right" });
    doc.text(formatNumber(totalSaldos), columnPositions[4] + 3, y + 6, { width: headerWidths[4] - 6, align: "right" });
    // Estado total: guión
    doc.text("-", columnPositions[5] + 3, y + 6, { width: headerWidths[5] - 6, align: "center" });

    // Línea final debajo de la tabla
    doc.moveTo(columnPositions[0], y + rowHeight).lineTo(columnPositions[0] + fullTableWidth, y + rowHeight).stroke();

    // Finalizar
    doc.end();
    console.log("[done] PDF stream ended");

  } catch (err) {
    console.error("[catch] error generando PDF:", err?.message || err);
    try {
      if (!res.headersSent) res.status(500).send(`Error generando el PDF: ${err?.message || err}`);
    } catch (sendErr) {
      console.error("[secondary error] al enviar la respuesta de error:", sendErr);
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
