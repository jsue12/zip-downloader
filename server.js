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
    // (Tablas omitidas por brevedad)
    // =============================
    // ...
    // Aquí permanece tu bloque de tablas de vague-stage y telling-match sin cambios

    // =============================
    // GRAFICOS (BARRAS + SECTORES)
    // =============================

    const hslToRgb = (h, s, l) => {
      s /= 100; l /= 100;
      const k = n => (n + h / 30) % 12;
      const a = s * Math.min(l, 1 - l);
      const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
      return [Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4))];
    };

    if (vagueRecords.length > 0) {
      const keys = Object.keys(vagueRecords[0]);

      const dataBarras = vagueRecords.map(row => ({
        nombre: String(row[keys[0]] ?? ""),
        valor: parseFloat(row[keys[4]] || 0)
      }));

      dataBarras.sort((a, b) => b.valor - a.valor);

      const totalGeneral = vagueRecords.reduce((s, r) => s + (parseFloat(r[keys[2]] || 0)), 0);
      const totalGasto = dataBarras.reduce((s, r) => s + r.valor, 0);
      const saldoDisponible = totalGeneral - totalGasto;

      // Página nueva para los gráficos
      doc.addPage();
      doc.font("Helvetica-Bold").fontSize(13).text("GRÁFICOS DE GASTOS", { align: "center" });
      doc.moveDown(0.5);
      doc.moveTo(70, doc.y).lineTo(540, doc.y).stroke();

      // === Gráfico de Barras ===
      doc.moveDown(1);
      doc.font("Helvetica-Bold").fontSize(11).text("GASTOS POR ESTUDIANTE (Barras)", { align: "left" });

      const chartX = 70;
      const chartY = doc.y + 30;
      const barMaxHeight = 180;
      const barWidth = 25;
      const gap = 15;
      const maxValue = Math.max(...dataBarras.map(d => d.valor));
      const chartBottom = chartY + barMaxHeight;

      dataBarras.forEach((item, i) => {
        const barHeight = (item.valor / maxValue) * barMaxHeight;
        const x = chartX + i * (barWidth + gap);
        const y = chartBottom - barHeight;

        const [r, g, b] = hslToRgb(i * 35, 65, 55);
        doc.save();
        doc.rect(x, y, barWidth, barHeight).fill(`rgb(${r},${g},${b})`).stroke();
        doc.restore();

        doc.fontSize(8).fillColor("black").text(formatNumber(item.valor), x - 5, y - 12, {
          width: barWidth + 10,
          align: "center"
        });

        doc.save();
        doc.rotate(-45, { origin: [x + barWidth / 2, chartBottom + 10] });
        doc.text(item.nombre, x + barWidth / 2 - 25, chartBottom + 10, {
          width: 60,
          align: "right"
        });
        doc.restore();
      });

      // === Gráfico de Sectores ===
      doc.moveDown(8);
      doc.font("Helvetica-Bold").fontSize(11).text("DISTRIBUCIÓN DE GASTOS (Sectores)", { align: "left" });
      doc.moveDown(0.5);

      const cx = 300;
      const cy = doc.y + 150;
      const radius = 100;

      const allSlices = [...dataBarras, { nombre: "Saldo disponible", valor: saldoDisponible }];
      const sumTotal = allSlices.reduce((s, v) => s + v.valor, 0);

      let startAngle = 0;
      allSlices.forEach((slice, i) => {
        const sliceAngle = (slice.valor / sumTotal) * Math.PI * 2;
        const endAngle = startAngle + sliceAngle;
        const [r, g, b] = hslToRgb(i * 40, 65, 55);

        doc.save();
        doc.moveTo(cx, cy);
        doc.arc(cx, cy, radius, startAngle, endAngle);
        doc.lineTo(cx, cy);
        doc.fill(`rgb(${r},${g},${b})`).stroke();
        doc.restore();

        const mid = startAngle + sliceAngle / 2;
        const labelX = cx + Math.cos(mid) * (radius + 25);
        const labelY = cy + Math.sin(mid) * (radius + 25);

        doc.font("Helvetica").fontSize(9).fillColor("black")
          .text(`${slice.nombre} (${((slice.valor / sumTotal) * 100).toFixed(1)}%)`,
                labelX - 30, labelY, { width: 80, align: "center" });

        startAngle = endAngle;
      });
    }

    // === Finalizar PDF ===
    doc.end();
    console.log("[done] PDF stream ended ✅");

  } catch (err) {
    console.error("Error generando PDF:", err);
    if (!res.headersSent) res.status(500).send(err.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
