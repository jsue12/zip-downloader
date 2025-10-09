import express from "express";
import PDFDocument from "pdfkit";
import csvtojson from "csvtojson";

// Para Node.js < 18, necesitamos node-fetch
let fetch;
try {
  // Intentar usar fetch nativo (Node.js 18+)
  if (typeof globalThis.fetch === 'undefined') {
    throw new Error('Fetch no disponible');
  }
  fetch = globalThis.fetch;
} catch (error) {
  // Fallback a node-fetch
  const nodeFetch = await import('node-fetch');
  fetch = nodeFetch.default;
}

const app = express();

// Middleware para logging de requests
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Validación de URLs
const isValidUrl = (string) => {
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
};

// Función para formatear números
const formatNumber = (n) => {
  const num = parseFloat(String(n).replace(/[^\d.-]/g, "")) || 0;
  return num.toLocaleString("es-EC", { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2, 
    useGrouping: true 
  });
};

// Funciones auxiliares para PDF
const fillRect = (doc, x, y, w, h, c) => {
  doc.save().rect(x, y, w, h).fill(c).restore();
};

const strokeRect = (doc, x, y, w, h) => {
  doc.save().strokeColor("#000").lineWidth(0.5).rect(x, y, w, h).stroke().restore();
};

// Función para formatear fecha
const formatDate = (dateString) => {
  try {
    const date = new Date(dateString);
    if (isNaN(date)) return dateString;
    
    return date.toLocaleDateString("es-EC", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    });
  } catch (error) {
    return dateString;
  }
};

app.get("/generar-reporte", async (req, res) => {
  console.log("[start] /generar-reporte request received");

  // Variable para control de páginas
  let pageNumber = 1;

  try {
    const urlsParam = req.query.url;
    if (!urlsParam) {
      return res.status(400).json({ 
        error: "Debes incluir el parámetro 'url' con las URLs separadas por comas." 
      });
    }

    const urls = urlsParam.split(",").map(u => u.trim()).filter(Boolean);
    
    // Validar URLs
    const invalidUrls = urls.filter(url => !isValidUrl(url));
    if (invalidUrls.length > 0) {
      return res.status(400).json({
        error: `URLs inválidas: ${invalidUrls.join(", ")}`
      });
    }

    // Descargar y procesar CSVs
    const csvDataArr = [];
    for (const url of urls) {
      try {
        console.log(`[fetch] Descargando: ${url}`);
        
        // Usar AbortController para timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        try {
          const response = await fetch(url, {
            signal: controller.signal,
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; ReportGenerator/1.0)'
            }
          });
          clearTimeout(timeoutId);
          
          if (!response.ok) {
            console.warn(`[fetch] Error ${response.status} para: ${url}`);
            continue;
          }

          const text = await response.text();
          if (!text.trim()) {
            console.warn(`[fetch] CSV vacío para: ${url}`);
            continue;
          }

          const jsonData = await csvtojson({
            checkType: false,
            trim: true
          }).fromString(text);

          csvDataArr.push({ 
            url, 
            data: jsonData,
            filename: url.split('/').pop() || 'unknown.csv'
          });
          
          console.log(`[fetch] Procesado: ${url} (${jsonData.length} registros)`);
          
        } catch (fetchError) {
          clearTimeout(timeoutId);
          if (fetchError.name === 'AbortError') {
            console.warn(`[fetch] Timeout para: ${url}`);
          } else {
            throw fetchError;
          }
        }
      } catch (error) {
        console.error(`[fetch] Error cargando ${url}:`, error.message);
      }
    }

    if (csvDataArr.length === 0) {
      return res.status(404).json({ 
        error: "No se pudieron cargar ninguno de los archivos CSV proporcionados." 
      });
    }

    // =============================
    // PROCESAR ARCHIVOS ESPECÍFICOS
    // =============================

    // ARCHIVO brawny-letters (resumen ejecutivo)
    const brawnyEntry = csvDataArr.find(c => 
      c.filename.toLowerCase().includes("brawny-letters") || 
      c.url.toLowerCase().includes("brawny-letters")
    );
    
    if (!brawnyEntry || !brawnyEntry.data || brawnyEntry.data.length === 0) {
      return res.status(404).json({ 
        error: "No se encontró o no se pudo leer brawny-letters.csv" 
      });
    }

    const brawnyRow = brawnyEntry.data[0] || {};
    const brawnyKeys = Object.keys(brawnyRow);
    const recibidos = parseFloat(brawnyRow[brawnyKeys[0]] || 0);
    const entregados = parseFloat(brawnyRow[brawnyKeys[1]] || 0);
    const saldo = parseFloat(brawnyRow[brawnyKeys[2]] || 0);

    // ARCHIVOS adicionales
    const vagueEntry = csvDataArr.find(c => 
      c.filename.toLowerCase().includes("vague-stage") ||
      c.url.toLowerCase().includes("vague-stage")
    );
    const vagueRecords = vagueEntry?.data?.filter(r => 
      Object.keys(r).length > 0 && Object.values(r).some(v => v !== null && v !== "")
    ) || [];

    const tellingEntry = csvDataArr.find(c => 
      c.filename.toLowerCase().includes("telling-match") ||
      c.url.toLowerCase().includes("telling-match")
    );
    const tellingRecords = tellingEntry?.data?.filter(r => 
      Object.keys(r).length > 0 && Object.values(r).some(v => v !== null && v !== "")
    ) || [];

    const pagosEntry = csvDataArr.find(c => 
      c.filename.toLowerCase().includes("pagos") ||
      c.url.toLowerCase().includes("pagos")
    );
    const pagosRecords = pagosEntry?.data?.filter(r => 
      Object.keys(r).length > 0 && Object.values(r).some(v => v !== null && v !== "")
    ) || [];

    // =============================
    // CREAR PDF
    // =============================
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=reporte-${Date.now()}.pdf`);

    const doc = new PDFDocument({ 
      margin: 50, 
      size: "A4",
      info: {
        Title: "Reporte de Transacciones",
        Author: "Sistema de Reportes",
        CreationDate: new Date()
      }
    });

    doc.pipe(res);

    // Función para pie de página
    const addFooter = (currentPageNumber) => {
      const pageHeight = doc.page.height;
      doc.fontSize(8).fillColor("#7f8c8d");
      doc.text(
        `Generado el ${new Date().toLocaleString("es-EC")} - Página ${currentPageNumber}`,
        50,
        pageHeight - 30,
        { align: "center", width: 500 }
      );
    };

    // Manejar eventos de página
    doc.on('pageAdded', () => {
      pageNumber++;
      // Esperar un momento para que la página se establezca completamente
      process.nextTick(() => {
        addFooter(pageNumber);
      });
    });

    // =============================
    // ENCABEZADO
    // =============================
    doc.font("Helvetica-Bold").fontSize(16).fillColor("#2c3e50")
       .text("REPORTE DE TRANSACCIONES", { align: "center" });
    doc.moveDown(0.5);
    
    doc.fontSize(10).fillColor("#34495e");
    doc.font("Helvetica-Bold").text("TESORERO:", { continued: true })
       .font("Helvetica").text(" JUAN PABLO BARBA MEDINA");
    doc.font("Helvetica-Bold").text("FECHA DEL INFORME:", { continued: true })
       .font("Helvetica").text(` ${new Date().toLocaleDateString("es-EC")}`);
    doc.moveDown();

    // =============================
    // RESUMEN EJECUTIVO
    // =============================
    doc.font("Helvetica-Bold").fontSize(12).fillColor("#2c3e50")
       .text("RESUMEN EJECUTIVO");
    doc.moveDown(0.5);
    
    doc.font("Helvetica").fontSize(11).fillColor("#2c3e50");
    doc.text(`VALORES RECIBIDOS (+): $ ${formatNumber(recibidos)}`, { indent: 20 });
    doc.text(`VALORES ENTREGADOS (-): $ ${formatNumber(entregados)}`, { indent: 20 });
    doc.font("Helvetica-Bold").text(`SALDO TOTAL (=): $ ${formatNumber(saldo)}`, { indent: 20 });
    
    doc.moveDown();
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#bdc3c7").stroke();
    doc.moveDown();

    // Pie de página para la primera página
    addFooter(pageNumber);

    // ==========================================================
    // SECCIÓN: LISTADO DE ESTUDIANTES
    // ==========================================================
    if (vagueRecords.length > 0) {
      if (doc.y > 600) {
        doc.addPage();
        // El footer se agregará automáticamente por el evento pageAdded
      }
      
      doc.font("Helvetica-Bold").fontSize(12).fillColor("#2c3e50")
         .text("LISTADO DE ESTUDIANTES");
      doc.moveDown(0.5);

      const marginLeft = 50;
      const colWidths = { nro: 35, estudiante: 162, cuotas: 72, abonos: 72, saldos: 72, estado: 82 };
      const columns = Object.values(colWidths);
      const positions = [];
      let accX = marginLeft;
      
      for (const width of columns) {
        positions.push(accX);
        accX += width;
      }

      const rowHeight = 22;
      const headers = ["N°", "ESTUDIANTE", "CUOTAS", "ABONOS", "SALDOS", "ESTADO"];

      const drawHeaders = (yPos) => {
        headers.forEach((header, index) => {
          fillRect(doc, positions[index], yPos, columns[index], rowHeight, "#ecf0f1");
          strokeRect(doc, positions[index], yPos, columns[index], rowHeight);
          doc.font("Helvetica-Bold").fontSize(9).fillColor("#2c3e50")
             .text(header, positions[index] + 4, yPos + 7, { 
               width: columns[index] - 8, 
               align: "center" 
             });
        });
      };

      let y = doc.y;
      drawHeaders(y);
      y += rowHeight;
      
      let totalCuotas = 0, totalAbonos = 0, totalSaldos = 0;

      vagueRecords.forEach((row, index) => {
        const keys = Object.keys(row);
        const estudiante = String(row[keys[0]] ?? "").trim();
        const cuotas = parseFloat(row[keys[1]] || 0);
        const abonos = parseFloat(row[keys[2]] || 0);
        const saldos = parseFloat(row[keys[3]] || 0);
        const estado = String(row[keys[5]] ?? "").trim().toUpperCase();

        totalCuotas += cuotas;
        totalAbonos += abonos;
        totalSaldos += saldos;

        // Salto de página si es necesario
        if (y + rowHeight > doc.page.height - 60) {
          doc.addPage();
          y = 50;
          drawHeaders(y);
          y += rowHeight;
        }

        // Fondo alterno para filas
        if (index % 2 === 0) {
          fillRect(doc, positions[0], y, columns.reduce((a, b) => a + b), rowHeight, "#fafafa");
        }

        // Dibujar bordes de celdas
        let currentX = positions[0];
        for (const width of columns) {
          strokeRect(doc, currentX, y, width, rowHeight);
          currentX += width;
        }

        // Contenido de celdas
        const textY = y + 7;
        doc.font("Helvetica").fontSize(9).fillColor("#2c3e50");
        
        doc.text(String(index + 1), positions[0] + 3, textY, { width: columns[0] - 6, align: "center" });
        doc.text(estudiante, positions[1] + 4, textY, { width: columns[1] - 8, align: "left" });
        doc.text(formatNumber(cuotas), positions[2] + 3, textY, { width: columns[2] - 6, align: "right" });
        doc.text(formatNumber(abonos), positions[3] + 3, textY, { width: columns[3] - 6, align: "right" });
        doc.text(formatNumber(saldos), positions[4] + 3, textY, { width: columns[4] - 6, align: "right" });

        // Color según estado
        let estadoColor = "#2c3e50";
        if (estado === "POR COBRAR") estadoColor = "#e74c3c";
        else if (estado === "REVISAR") estadoColor = "#3498db";
        else if (estado === "PAGADO") estadoColor = "#27ae60";
        
        doc.fillColor(estadoColor);
        doc.text(estado, positions[5] + 3, textY, { width: columns[5] - 6, align: "center" });
        doc.fillColor("#2c3e50"); // Reset color
        
        y += rowHeight;
      });

      // TOTALES
      if (y + rowHeight > doc.page.height - 60) {
        doc.addPage();
        y = 50;
      }

      const totalWidthAll = columns.reduce((a, b) => a + b);
      const firstTwoWidth = columns[0] + columns[1];

      fillRect(doc, positions[0], y, totalWidthAll, rowHeight, "#ecf0f1");
      
      // Bordes para celdas combinadas
      strokeRect(doc, positions[0], y, firstTwoWidth, rowHeight);
      let xPos = positions[2];
      for (let i = 2; i < columns.length; i++) {
        strokeRect(doc, xPos, y, columns[i], rowHeight);
        xPos += columns[i];
      }

      const totalTextY = y + 7;
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#2c3e50");
      doc.text("TOTAL GENERAL", positions[0] + 4, totalTextY, { width: firstTwoWidth - 8, align: "center" });
      doc.text(formatNumber(totalCuotas), positions[2] + 3, totalTextY, { width: columns[2] - 6, align: "right" });
      doc.text(formatNumber(totalAbonos), positions[3] + 3, totalTextY, { width: columns[3] - 6, align: "right" });
      doc.text(formatNumber(totalSaldos), positions[4] + 3, totalTextY, { width: columns[4] - 6, align: "right" });
      doc.text("—", positions[5] + 3, totalTextY, { width: columns[5] - 6, align: "center" });
      
      doc.moveDown(2);
    }

    // ==========================================================
    // SECCIÓN: TRANSACCIONES DE COBRO
    // ==========================================================
    if (tellingRecords.length > 0) {
      if (doc.y + 100 > doc.page.height - 50) {
        doc.addPage();
      }
      
      doc.font("Helvetica-Bold").fontSize(12).fillColor("#2c3e50")
         .text("TRANSACCIONES DE COBRO");
      doc.moveDown(0.5);

      const margin = 50;
      const rowHeight = 22;
      const colWidths = { nro: 35, fecha: 69, estudiante: 135, banco: 101, comprobante: 90, valor: 65 };
      const positions = [];
      let currentX = margin;
      
      for (const width of Object.values(colWidths)) {
        positions.push(currentX);
        currentX += width;
      }

      const headers = ["N°", "FECHA", "ESTUDIANTE", "BANCO", "# COMPROBANTE", "VALOR"];

      const drawTableHeaders = (yPos) => {
        headers.forEach((header, index) => {
          const width = Object.values(colWidths)[index];
          fillRect(doc, positions[index], yPos, width, rowHeight, "#ecf0f1");
          strokeRect(doc, positions[index], yPos, width, rowHeight);
          doc.font("Helvetica-Bold").fontSize(9).fillColor("#2c3e50")
             .text(header, positions[index] + 4, yPos + 7.5, { 
               width: width - 8, 
               align: "center" 
             });
        });
      };

      let y = doc.y;
      drawTableHeaders(y);
      y += rowHeight;

      let totalValor = 0;

      tellingRecords.forEach((record, index) => {
        const values = Object.values(record);
        const fecha = formatDate(values[0] || "");
        const estudiante = String(values[1] || "").trim();
        const banco = String(values[2] || "").trim();
        const comprobante = String(values[3] || "");
        const valor = parseFloat(String(values[4]).replace(/[^\d.-]/g, "")) || 0;
        
        totalValor += valor;

        if (y + rowHeight > doc.page.height - 60) {
          doc.addPage();
          y = 50;
          drawTableHeaders(y);
          y += rowHeight;
        }

        if (index % 2 === 0) {
          fillRect(doc, positions[0], y, 495, rowHeight, "#fafafa");
        }

        let x = positions[0];
        for (const width of Object.values(colWidths)) {
          strokeRect(doc, x, y, width, rowHeight);
          x += width;
        }

        const textY = y + 7.5;
        doc.font("Helvetica").fontSize(9).fillColor("#2c3e50");
        doc.text(String(index + 1), positions[0] + 3, textY, { width: colWidths.nro - 6, align: "center" });
        doc.text(fecha, positions[1] + 3, textY, { width: colWidths.fecha - 6, align: "center" });
        doc.text(estudiante, positions[2] + 4, textY, { width: colWidths.estudiante - 8, align: "left" });
        doc.text(banco, positions[3] + 4, textY, { width: colWidths.banco - 8, align: "left" });
        doc.text(comprobante, positions[4] + 4, textY, { width: colWidths.comprobante - 8, align: "left" });
        doc.text(formatNumber(valor), positions[5] + 3, textY, { width: colWidths.valor - 6, align: "right" });

        y += rowHeight;
      });

      // TOTAL TRANSACCIONES DE COBRO
      if (y + rowHeight > doc.page.height - 60) {
        doc.addPage();
        y = 50;
      }

      const totalWidth = Object.values(colWidths).slice(0, 5).reduce((a, b) => a + b, 0);

      fillRect(doc, positions[0], y, totalWidth + colWidths.valor, rowHeight, "#ecf0f1");
      strokeRect(doc, positions[0], y, totalWidth, rowHeight);
      strokeRect(doc, positions[5], y, colWidths.valor, rowHeight);

      const totalTextY = y + 7.5;
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#2c3e50");
      doc.text("TOTAL DE VALORES RECIBIDOS", positions[0] + 4, totalTextY, { 
        width: totalWidth - 8, 
        align: "right" 
      });
      doc.text(formatNumber(totalValor), positions[5] + 3, totalTextY, { 
        width: colWidths.valor - 6, 
        align: "right" 
      });
      
      doc.moveDown(2);
    }

    // ==========================================================
    // SECCIÓN: RESUMEN DE VALORES PAGADOS
    // ==========================================================
    if (vagueRecords.length > 0) {
      if (doc.y + 80 > doc.page.height - 50) {
        doc.addPage();
      }

      doc.font("Helvetica-Bold").fontSize(12).fillColor("#2c3e50")
         .text("RESUMEN DE VALORES PAGADOS");
      doc.moveDown(0.5);

      const gastosData = vagueRecords.map(row => {
        const keys = Object.keys(row);
        return {
          estudiante: String(row[keys[0]] || "").trim(),
          gasto: parseFloat(row[keys[4]] || 0)
        };
      }).filter(item => item.estudiante && !isNaN(item.gasto));

      gastosData.sort((a, b) => b.gasto - a.gasto);

      const totalGasto = gastosData.reduce((sum, item) => sum + item.gasto, 0);

      const labelWidth = 22;
      const barMaxLength = 40;

      doc.font("Courier").fontSize(9).fillColor("#2c3e50");

      gastosData.forEach(item => {
        if (doc.y + 15 > doc.page.height - 50) {
          doc.addPage();
          doc.y = 50;
        }

        const porcentaje = totalGasto > 0 ? (item.gasto / totalGasto) * 100 : 0;
        const barLength = totalGasto > 0 ? Math.round((item.gasto / totalGasto) * barMaxLength) : 0;
        const bar = "█".repeat(barLength).padEnd(barMaxLength, " ");

        const nombre = item.estudiante.padEnd(labelWidth).substring(0, labelWidth);
        const leyenda = `${formatNumber(item.gasto)} — ${porcentaje.toFixed(2)}%`;

        doc.text(`${nombre} | ${bar} | ${leyenda}`, 50, doc.y);
      });
      
      doc.moveDown();
    }

    // ==========================================================
    // SECCIÓN: TRANSACCIONES DE PAGO
    // ==========================================================
    if (pagosRecords.length > 0) {
      // Ordenar por fecha
      pagosRecords.sort((a, b) => {
        const dateA = new Date(a.fecha || a.Fecha || "");
        const dateB = new Date(b.fecha || b.Fecha || "");
        return dateA - dateB;
      });

      if (doc.y + 100 > doc.page.height - 50) {
        doc.addPage();
      }

      doc.font("Helvetica-Bold").fontSize(12).fillColor("#2c3e50")
         .text("TRANSACCIONES DE PAGO");
      doc.moveDown(0.5);

      const margin = 50;
      const rowHeight = 22;
      const colWidths = { nro: 35, fecha: 69, estudiante: 135, concepto: 101, numfac: 90, valor: 65 };
      const positions = [];
      let currentX = margin;
      
      for (const width of Object.values(colWidths)) {
        positions.push(currentX);
        currentX += width;
      }

      const headers = ["N°", "FECHA", "ESTUDIANTE", "CONCEPTO", "# FAC O COT", "VALOR"];
      const totalWidth = Object.values(colWidths).reduce((a, b) => a + b);

      const drawPagosHeaders = (yPos) => {
        headers.forEach((header, index) => {
          const width = Object.values(colWidths)[index];
          fillRect(doc, positions[index], yPos, width, rowHeight, "#ecf0f1");
          strokeRect(doc, positions[index], yPos, width, rowHeight);
          doc.font("Helvetica-Bold").fontSize(9).fillColor("#2c3e50")
             .text(header, positions[index] + 4, yPos + 7, {
               width: width - 8,
               align: "center"
             });
        });
      };

      let y = doc.y;
      drawPagosHeaders(y);
      y += rowHeight;

      let totalValorPagos = 0;

      pagosRecords.forEach((record, index) => {
        const fecha = formatDate(record.fecha || record.Fecha || "");
        const estudiante = String(record.estudiante || record.Estudiante || "").trim();
        const concepto = String(record.concepto || record.Concepto || "").trim();
        const numfac = String(record.numfac || record.NumFac || "").trim();
        const valor = parseFloat(String(record.valor || record.Valor).replace(/[^\d.-]/g, "")) || 0;
        
        totalValorPagos += valor;

        if (y + rowHeight > doc.page.height - 60) {
          doc.addPage();
          y = 50;
          drawPagosHeaders(y);
          y += rowHeight;
        }

        if (index % 2 === 0) {
          fillRect(doc, positions[0], y, totalWidth, rowHeight, "#fafafa");
        }

        let x = positions[0];
        for (const width of Object.values(colWidths)) {
          strokeRect(doc, x, y, width, rowHeight);
          x += width;
        }

        const textY = y + 7.5;
        doc.font("Helvetica").fontSize(9).fillColor("#2c3e50");
        doc.text(String(index + 1), positions[0] + 3, textY, { width: colWidths.nro - 6, align: "center" });
        doc.text(fecha, positions[1] + 3, textY, { width: colWidths.fecha - 6, align: "center" });
        doc.text(estudiante, positions[2] + 4, textY, { width: colWidths.estudiante - 8, align: "left" });
        doc.text(concepto, positions[3] + 4, textY, { width: colWidths.concepto - 8, align: "left" });
        doc.text(numfac, positions[4] + 4, textY, { width: colWidths.numfac - 8, align: "left" });
        doc.text(formatNumber(valor), positions[5] + 4, textY, { width: colWidths.valor - 8, align: "right" });
        
        y += rowHeight;
      });

      // TOTAL TRANSACCIONES DE PAGO
      if (y + rowHeight > doc.page.height - 60) {
        doc.addPage();
        y = 50;
      }

      fillRect(doc, positions[0], y, totalWidth, rowHeight, "#ecf0f1");
      strokeRect(doc, positions[0], y, totalWidth, rowHeight);
      strokeRect(doc, positions[5], y, colWidths.valor, rowHeight);

      const totalTextY = y + 7;
      const firstFiveWidth = Object.values(colWidths).slice(0, 5).reduce((a, b) => a + b, 0);

      doc.font("Helvetica-Bold").fontSize(9).fillColor("#2c3e50");
      doc.text("TOTAL DE VALORES ENTREGADOS", positions[0] + 4, totalTextY, {
        width: firstFiveWidth - 8,
        align: "right"
      });
      doc.text(formatNumber(totalValorPagos), positions[5] + 4, totalTextY, {
        width: colWidths.valor - 8,
        align: "right"
      });
    }

    // =============================
    // FINALIZAR PDF
    // =============================
    doc.end();

    doc.on('end', () => {
      console.log("[done] PDF generado exitosamente ✅");
    });

    doc.on('error', (error) => {
      console.error("[error] Error en generación de PDF:", error);
      if (!res.headersSent) {
        res.status(500).json({ 
          error: "Error generando el PDF",
          details: error.message 
        });
      }
    });

  } catch (error) {
    console.error("[error] Error generando PDF:", error);
    if (!res.headersSent) {
      res.status(500).json({ 
        error: "Error interno del servidor al generar el reporte",
        details: error.message 
      });
    }
  }
});

// Manejo de errores global
app.use((error, req, res, next) => {
  console.error('[global error]', error);
  res.status(500).json({ 
    error: "Error interno del servidor",
    details: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
});

// Ruta de salud
app.get("/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// Ruta de ejemplo para testing
app.get("/test", (req, res) => {
  res.json({ 
    message: "Servidor funcionando correctamente",
    endpoints: {
      generar_reporte: "GET /generar-reporte?url=URL1,URL2,URL3",
      health: "GET /health"
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`📊 Endpoint principal: http://localhost:${PORT}/generar-reporte`);
  console.log(`❤️  Health check: http://localhost:${PORT}/health`);
  console.log(`🧪 Test: http://localhost:${PORT}/test`);
});
