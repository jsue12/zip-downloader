import express from "express";
import PDFDocument from "pdfkit";
import csvtojson from "csvtojson";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch"; // ✅ necesario si usas Node < 18

const app = express();

// Configuración de rutas absolutas
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.get("/generar-reporte", async (req, res) => {
  console.log("[start] /generar-reporte request received");

  try {
    const urlsParam = req.query.url;
    if (!urlsParam) {
      return res.status(400).send("Error: Debes incluir el parámetro 'url' con las URLs separadas por comas.");
    }

    const urls = urlsParam.split(",").map(u => u.trim()).filter(Boolean);

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

    // ✅ Fuente Unicode (para mostrar █ correctamente)
    const fontPath = path.join(__dirname, "fuentes", "ttf", "DejaVuSans.ttf");
    doc.registerFont("DejaVuSans", fontPath);

    const formatNumber = n => {
      const num = parseFloat(String(n).replace(/[^\d.-]/g, "")) || 0;
      return num.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    // =============================
    // ENCABEZADO
    // =============================
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
    // GRÁFICO FINAL — barras con █
    // =============================
    if (doc.y + 80 > doc.page.height - 50) {
      doc.addPage();
      doc.y = 50;
    }

    doc.font("Helvetica-Bold").fontSize(12);
    doc.text("RESUMEN DE VALORES PAGADOS", 50, doc.y, { align: "left", width: 500 });
    doc.moveDown(1);

    const vagueMatrix = vagueRecords.map(row => {
      const keys = Object.keys(row);
      const estudiante = String(row[keys[0]] || "").trim();
      const gasto = parseFloat(row[keys[4]] || 0);
      return { estudiante, gasto };
    }).filter(r => r.estudiante && !isNaN(r.gasto));

    vagueMatrix.sort((a, b) => b.gasto - a.gasto);

    const totalGasto = vagueMatrix.reduce((sum, r) => sum + r.gasto, 0);
    const maxGasto = Math.max(...vagueMatrix.map(r => r.gasto));

    const labelWidth = 18;
    const barMaxChars = 40;
    const barChar = "█"; // ✅ bloque sólido Unicode
    const spacing = 3;

    // ✅ usar fuente Unicode
    doc.font("DejaVuSans").fontSize(9).fillColor("black");

    vagueMatrix.forEach(({ estudiante, gasto }) => {
      if (doc.y + 15 > doc.page.height - 50) {
        doc.addPage();
        doc.y = 50;
      }

      const porcentaje = totalGasto > 0 ? (gasto / totalGasto) * 100 : 0;
      const barLength = maxGasto > 0 ? Math.round((gasto / maxGasto) * barMaxChars) : 0;

      const bar = barChar.repeat(barLength).padEnd(barMaxChars, " ");
      const nombre = estudiante.padEnd(labelWidth).substring(0, labelWidth);
      const legend = `${formatNumber(gasto)} — ${porcentaje.toFixed(2)}%`;

      const line = `${nombre} | ${bar} | ${legend}`;
      doc.text(line, 50, doc.y);
    });

    doc.end();
    console.log("[done] PDF stream ended ✅");
  } catch (err) {
    console.error("Error generando PDF:", err);
    if (!res.headersSent) res.status(500).send(err.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
