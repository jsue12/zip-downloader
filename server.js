import express from "express";
import PDFDocument from "pdfkit";
import csvtojson from "csvtojson";

// Configurar fetch (compatibilidad Node.js <18)
let fetch;
try {
  if (typeof globalThis.fetch === "undefined") {
    throw new Error("Fetch no disponible");
  }
  fetch = globalThis.fetch;
} catch {
  const nodeFetch = await import("node-fetch");
  fetch = nodeFetch.default;
}

const app = express();

// Validación de URLs
const isValidUrl = (string) => {
  try {
    const url = new URL(string);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

// Formateo de números
const formatNumber = (n) => {
  const num = parseFloat(String(n).replace(/[^\d.-]/g, "")) || 0;
  return num.toLocaleString("es-EC", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  });
};

// Funciones auxiliares para PDF
const fillRect = (doc, x, y, w, h, c) => {
  doc.save().rect(x, y, w, h).fill(c).restore();
};

const strokeRect = (doc, x, y, w, h) => {
  doc.save().strokeColor("#000").lineWidth(0.5).rect(x, y, w, h).stroke().restore();
};

// Formateo de fechas
const formatDate = (dateString) => {
  try {
    const date = new Date(dateString);
    if (isNaN(date)) return dateString;
    return date.toLocaleDateString("es-EC", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return dateString;
  }
};

app.get("/generar-reporte", async (req, res) => {
  console.log("[start] Generando reporte...");

  let pageNumber = 1;

  try {
    const urlsParam = req.query.url;
    if (!urlsParam) {
      return res.status(400).json({
        error: "Debes incluir el parámetro 'url' con las URLs separadas por comas.",
      });
    }

    const urls = urlsParam.split(",").map((u) => u.trim()).filter(Boolean);
    const invalidUrls = urls.filter((url) => !isValidUrl(url));

    if (invalidUrls.length > 0) {
      return res.status(400).json({
        error: `URLs inválidas: ${invalidUrls.join(", ")}`,
      });
    }

    // Descargar CSVs
    const csvDataArr = [];
    for (const url of urls) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        const response = await fetch(url, {
          signal: controller.signal,
          headers: { "User-Agent": "Mozilla/5.0 (compatible; ReportGenerator/1.0)" },
        });

        clearTimeout(timeoutId);

        if (!response.ok) continue;
        const text = await response.text();
        if (!text.trim()) continue;

        const jsonData = await csvtojson({ checkType: false, trim: true }).fromString(text);

        csvDataArr.push({
          url,
          data: jsonData,
          filename: url.split("/").pop() || "unknown.csv",
        });
      } catch {
        // Ignorar errores de descarga individuales
      }
    }

    if (csvDataArr.length === 0) {
      return res.status(404).json({
        error: "No se pudieron cargar los archivos CSV proporcionados.",
      });
    }

    // Procesar archivo principal
    const brawnyEntry = csvDataArr.find(
      (c) =>
        c.filename.toLowerCase().includes("brawny-letters") ||
        c.url.toLowerCase().includes("brawny-letters")
    );

    if (!brawnyEntry || !brawnyEntry.data.length) {
      return res.status(404).json({
        error: "No se encontró o no se pudo leer brawny-letters.csv",
      });
    }

    const brawnyRow = brawnyEntry.data[0];
    const keys = Object.keys(brawnyRow);
    const recibidos = parseFloat(brawnyRow[keys[0]] || 0);
    const entregados = parseFloat(brawnyRow[keys[1]] || 0);
    const saldo = parseFloat(brawnyRow[keys[2]] || 0);

    const vagueRecords =
      csvDataArr.find((c) =>
        ["vague-stage"].some((name) => c.filename.toLowerCase().includes(name))
      )?.data || [];

    const tellingRecords =
      csvDataArr.find((c) =>
        ["telling-match"].some((name) => c.filename.toLowerCase().includes(name))
      )?.data || [];

    const pagosRecords =
      csvDataArr.find((c) =>
        ["pagos"].some((name) => c.filename.toLowerCase().includes(name))
      )?.data || [];

    // Crear PDF
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=reporte-${Date.now()}.pdf`);

    const doc = new PDFDocument({
      margin: 50,
      size: "A4",
      info: {
        Title: "Reporte de Transacciones",
        Author: "Sistema de Reportes",
        CreationDate: new Date(),
      },
    });

    doc.pipe(res);

    const addFooter = (num) => {
      const pageHeight = doc.page.height;
      doc.fontSize(8).fillColor("#7f8c8d");
      doc.text(
        `Generado el ${new Date().toLocaleString("es-EC")} - Página ${num}`,
        50,
        pageHeight - 30,
        { align: "center", width: 500 }
      );
    };

    doc.on("pageAdded", () => {
      pageNumber++;
      process.nextTick(() => addFooter(pageNumber));
    });

    // ENCABEZADO
    doc.font("Helvetica-Bold").fontSize(16).fillColor("#2c3e50").text("REPORTE DE TRANSACCIONES", {
      align: "center",
    });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor("#34495e");
    doc.font("Helvetica-Bold").text("TESORERO:", { continued: true });
    doc.font("Helvetica").text(" JUAN PABLO BARBA MEDINA");
    doc.font("Helvetica-Bold").text("FECHA DEL INFORME:", { continued: true });
    doc.font("Helvetica").text(` ${new Date().toLocaleDateString("es-EC")}`);
    doc.moveDown();

    // RESUMEN EJECUTIVO
    doc.font("Helvetica-Bold").fontSize(12).fillColor("#2c3e50").text("RESUMEN EJECUTIVO");
    doc.moveDown(0.5);
    doc.font("Helvetica").fontSize(11).fillColor("#2c3e50");
    doc.text(`VALORES RECIBIDOS (+): $ ${formatNumber(recibidos)}`, { indent: 20 });
    doc.text(`VALORES ENTREGADOS (-): $ ${formatNumber(entregados)}`, { indent: 20 });
    doc.font("Helvetica-Bold").text(`SALDO TOTAL (=): $ ${formatNumber(saldo)}`, { indent: 20 });
    doc.moveDown();
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#bdc3c7").stroke();
    doc.moveDown();
    addFooter(pageNumber);
    // SECCIÓN: DETALLE DE REGISTROS
    if (tellingRecords.length > 0) {
      doc.addPage();
      doc.font("Helvetica-Bold").fontSize(12).fillColor("#2c3e50").text("DETALLE DE REGISTROS");
      doc.moveDown(0.5);

      const colWidths = [80, 150, 120, 120];
      const headers = ["Fecha", "Estudiante", "Banco", "Valor"];
      const startY = doc.y;

      // Dibujar encabezado de tabla
      fillRect(doc, 50, startY, 495, 20, "#2c3e50");
      doc.fillColor("#fff").font("Helvetica-Bold").fontSize(10);
      let x = 50;
      headers.forEach((header, i) => {
        doc.text(header, x + 4, startY + 5, { width: colWidths[i] - 8 });
        x += colWidths[i];
      });

      // Filas
      let y = startY + 20;
      doc.font("Helvetica").fontSize(9).fillColor("#2c3e50");

      tellingRecords.forEach((row) => {
        const fecha = formatDate(row["Fecha"] || row["fecha"]);
        const estudiante = String(row["Estudiante"] || row["estudiante"] || "").trim();
        const banco = String(row["Banco"] || row["banco"] || "").trim();
        const valor = formatNumber(row["Valor"] || row["valor"]);

        if (y > 750) {
          doc.addPage();
          y = 60;
        }

        const data = [fecha, estudiante, banco, `$ ${valor}`];
        let x = 50;
        data.forEach((cell, i) => {
          strokeRect(doc, x, y, colWidths[i], 20);
          doc.text(cell, x + 4, y + 5, { width: colWidths[i] - 8 });
          x += colWidths[i];
        });
        y += 20;
      });

      doc.moveDown(2);
    }

    // SECCIÓN: PAGOS
    if (pagosRecords.length > 0) {
      doc.addPage();
      doc.font("Helvetica-Bold").fontSize(12).fillColor("#2c3e50").text("REGISTRO DE PAGOS");
      doc.moveDown(0.5);

      const colWidths = [120, 200, 100, 100];
      const headers = ["Fecha", "Descripción", "Monto", "Estado"];
      const startY = doc.y;

      // Encabezado
      fillRect(doc, 50, startY, 495, 20, "#2c3e50");
      doc.fillColor("#fff").font("Helvetica-Bold").fontSize(10);
      let x = 50;
      headers.forEach((header, i) => {
        doc.text(header, x + 4, startY + 5, { width: colWidths[i] - 8 });
        x += colWidths[i];
      });

      // Filas
      let y = startY + 20;
      doc.font("Helvetica").fontSize(9).fillColor("#2c3e50");

      pagosRecords.forEach((row) => {
        const fecha = formatDate(row["Fecha"] || row["fecha"]);
        const descripcion = String(row["Descripción"] || row["descripcion"] || "").trim();
        const monto = formatNumber(row["Monto"] || row["monto"]);
        const estado = String(row["Estado"] || row["estado"] || "").trim();

        if (y > 750) {
          doc.addPage();
          y = 60;
        }

        const data = [fecha, descripcion, `$ ${monto}`, estado];
        let x = 50;
        data.forEach((cell, i) => {
          strokeRect(doc, x, y, colWidths[i], 20);
          doc.text(cell, x + 4, y + 5, { width: colWidths[i] - 8 });
          x += colWidths[i];
        });
        y += 20;
      });
      doc.moveDown(2);
    }

    // SECCIÓN: VAGUE STAGE (si existe)
    if (vagueRecords.length > 0) {
      doc.addPage();
      doc.font("Helvetica-Bold").fontSize(12).fillColor("#2c3e50").text("RESUMEN DE VAGUE STAGE");
      doc.moveDown(0.5);
      doc.font("Helvetica").fontSize(10).fillColor("#2c3e50");

      vagueRecords.forEach((r, i) => {
        const text = Object.entries(r)
          .map(([k, v]) => `${k}: ${v}`)
          .join(" | ");
        doc.text(`${i + 1}. ${text}`, { width: 500 });
        doc.moveDown(0.5);
      });
    }

    // FINALIZAR PDF
    doc.end();

    doc.on("end", () => {
      console.log("[done] PDF generado exitosamente ✅");
    });

    doc.on("error", (error) => {
      console.error("[error] Error generando PDF:", error.message);
      if (!res.headersSent) {
        res.status(500).json({
          error: "Error generando el PDF",
          details: error.message,
        });
      }
    });
  } catch (error) {
    console.error("[error] Error general:", error.message);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Error interno del servidor al generar el reporte",
        details: error.message,
      });
    }
  }
});

// Manejo de errores global
app.use((error, req, res, next) => {
  console.error("[global error]", error.message);
  res.status(500).json({
    error: "Error interno del servidor",
  });
});

// Ruta de salud
app.get("/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// Ruta de ejemplo
app.get("/test", (req, res) => {
  res.json({
    message: "Servidor funcionando correctamente",
    endpoints: {
      generar_reporte: "GET /generar-reporte?url=URL1,URL2,URL3",
      health: "GET /health",
    },
  });
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`📊 Endpoint principal: http://localhost:${PORT}/generar-reporte`);
});
