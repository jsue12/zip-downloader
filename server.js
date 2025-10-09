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
      return num.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 , useGrouping: true});
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
    // TABLA: vague-stage (solo si hay datos)
    // =============================
    if (vagueRecords.length > 0) {
      doc.addPage();
      doc.font("Helvetica-Bold").fontSize(12).text("DETALLE DE APORTES POR ESTUDIANTE");
      doc.moveDown(0.5);

      const startX = 50;
      const startY = doc.y;
      const columnWidths = [180, 120, 120, 120];
      const rowHeight = 20;

      const headers = ["Estudiante", "Total Cuotas", "Pagado", "Saldo"];
      const positions = [startX, startX + columnWidths[0], startX + columnWidths[0] + columnWidths[1],
                         startX + columnWidths[0] + columnWidths[1] + columnWidths[2]];

      // Encabezado
      fillRect(doc, startX, startY, columnWidths.reduce((a, b) => a + b), rowHeight, "#efefef");
      doc.font("Helvetica-Bold").fontSize(10);
      headers.forEach((h, i) => {
        doc.text(h, positions[i] + 3, startY + 6, { width: columnWidths[i] - 6, align: "center" });
      });
      strokeRect(doc, startX, startY, columnWidths.reduce((a, b) => a + b), rowHeight);

      // Filas
      doc.font("Helvetica").fontSize(10);
      let y = startY + rowHeight;

      vagueRecords.forEach((r) => {
        const keys = Object.keys(r);
        const nombre = r[keys[0]] || "";
        const total = formatNumber(r[keys[1]] || 0);
        const pagado = formatNumber(r[keys[2]] || 0);
        const saldo = formatNumber(r[keys[3]] || 0);

        [nombre, total, pagado, saldo].forEach((val, i) => {
          doc.text(val, positions[i] + 3, y + 6, { width: columnWidths[i] - 6, align: i === 0 ? "left" : "right" });
        });

        strokeRect(doc, startX, y, columnWidths.reduce((a, b) => a + b), rowHeight);
        y += rowHeight;
      });

      doc.moveTo(startX, y).lineTo(545, y).stroke();
      doc.moveDown();
    }

    // =============================
    // TABLA: telling-match (solo si hay datos)
    // =============================
    if (tellingRecords.length > 0) {
      doc.addPage();
      doc.font("Helvetica-Bold").fontSize(12).text("DETALLE DE MOVIMIENTOS");
      doc.moveDown(0.5);

      const startX = 50;
      const startY = doc.y;
      const columnWidths = [80, 200, 120, 120];
      const rowHeight = 20;

      const headers = ["Fecha", "Detalle", "Ingreso", "Egreso"];
      const positions = [startX, startX + columnWidths[0], startX + columnWidths[0] + columnWidths[1],
                         startX + columnWidths[0] + columnWidths[1] + columnWidths[2]];

      fillRect(doc, startX, startY, columnWidths.reduce((a, b) => a + b), rowHeight, "#efefef");
      doc.font("Helvetica-Bold").fontSize(10);
      headers.forEach((h, i) => {
        doc.text(h, positions[i] + 3, startY + 6, { width: columnWidths[i] - 6, align: "center" });
      });
      strokeRect(doc, startX, startY, columnWidths.reduce((a, b) => a + b), rowHeight);

      doc.font("Helvetica").fontSize(10);
      let y = startY + rowHeight;

      tellingRecords.forEach((r) => {
        const fecha = r["Fecha"] || r["fecha"] || "";
        const detalle = r["Detalle"] || r["detalle"] || "";
        const ingreso = formatNumber(r["Ingreso"] || r["ingreso"] || 0);
        const egreso = formatNumber(r["Egreso"] || r["egreso"] || 0);

        [fecha, detalle, ingreso, egreso].forEach((val, i) => {
          doc.text(val, positions[i] + 3, y + 6, { width: columnWidths[i] - 6, align: i < 2 ? "left" : "right" });
        });

        strokeRect(doc, startX, y, columnWidths.reduce((a, b) => a + b), rowHeight);
        y += rowHeight;
      });

      doc.moveTo(startX, y).lineTo(545, y).stroke();
      doc.moveDown();
    }

    // =============================
    // ARCHIVO PAGOS (si existe)
    // =============================
    const pagosEntry = csvDataArr.find(c => c.url.toLowerCase().includes("PAGOS"));
    const pagosRecords = pagosEntry?.data || [];

    if (pagosRecords.length > 0) {
      doc.addPage();
      doc.font("Helvetica-Bold").fontSize(12).text("RESUMEN DE PAGOS AGRUPADOS");
      doc.moveDown(0.5);

      const startX = 50;
      const startY = doc.y;
      const columnWidths = [250, 200, 80];
      const rowHeight = 20;

      const headers = ["Categoría", "Detalle", "Monto"];
      const positions = [startX, startX + columnWidths[0], startX + columnWidths[0] + columnWidths[1]];

      fillRect(doc, startX, startY, columnWidths.reduce((a, b) => a + b), rowHeight, "#efefef");
      doc.font("Helvetica-Bold").fontSize(10);
      headers.forEach((h, i) => {
        doc.text(h, positions[i] + 3, startY + 6, { width: columnWidths[i] - 6, align: "center" });
      });
      strokeRect(doc, startX, startY, columnWidths.reduce((a, b) => a + b), rowHeight);

      doc.font("Helvetica").fontSize(10);
      let y = startY + rowHeight;

      pagosRecords.forEach((r) => {
        const keys = Object.keys(r);
        const categoria = r[keys[0]] || "";
        const detalle = r[keys[1]] || "";
        const monto = formatNumber(r[keys[2]] || 0);

        [categoria, detalle, monto].forEach((val, i) => {
          doc.text(val, positions[i] + 3, y + 6, { width: columnWidths[i] - 6, align: i === 2 ? "right" : "left" });
        });

        strokeRect(doc, startX, y, columnWidths.reduce((a, b) => a + b), rowHeight);
        y += rowHeight;
      });

      doc.moveTo(startX, y).lineTo(545, y).stroke();
      doc.moveDown();
    }
    // =============================
    // CIERRE DEL DOCUMENTO PDF
    // =============================
    doc.addPage();
    doc.font("Helvetica-Bold").fontSize(12).text("OBSERVACIONES FINALES");
    doc.moveDown(0.5);
    doc.font("Helvetica").fontSize(11).text(
      "Este reporte consolida la información disponible en los archivos CSV cargados, incluyendo aportes, movimientos y pagos agrupados. Los valores reflejan el estado contable al momento de la generación del informe."
    );

    doc.moveDown(2);
    doc.text("_________________________", 50, doc.y);
    doc.text("Firma del Tesorero", 50, doc.y + 5);
    doc.end();

  } catch (err) {
    console.error("Error al generar el reporte:", err);
    res.status(500).send("Error interno al generar el reporte.");
  }
});

// =============================
// SERVIDOR EXPRESS
// =============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor ejecutándose en http://localhost:${PORT}`);
});
