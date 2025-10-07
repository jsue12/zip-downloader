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
          .text(h, positions[i] + 4, yPos + 7, { width: columns[i] - 8, align: "center" });
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

      const textY = y + 7;
      doc.font("Helvetica").fontSize(10).fillColor("black");
      doc.text(String(i + 1), positions[0] + 3, textY, { width: columns[0] - 6, align: "center" });
      doc.text(estudiante, positions[1] + 4, textY, { width: columns[0] +columns[1] - 8, align: "left" });
      doc.text(formatNumber(cuotas), positions[2] + 3, textY, { width: columns[2] - 6, align: "right" });
      doc.text(formatNumber(abonos), positions[3] + 3, textY, { width: columns[3] - 6, align: "right" });
      doc.text(formatNumber(saldos), positions[4] + 3, textY, { width: columns[4] - 6, align: "right" });

      doc.fillColor(estado === "POR COBRAR" ? "red" : estado === "REVISAR" ? "blue" : "black");
      doc.text(estado, positions[5] + 3, textY, { width: columns[5] - 6, align: "center" });
      y += rowHeight;
    });

    if (y + rowHeight > doc.page.height - 60) { 
      doc.addPage(); 
      y = 50; 
    }
    
    // Cálculo de anchos combinados
    const totalWidthAll = columns.reduce((a, b) => a + b); // ancho total
    const firstTwoWidth = columns[0] + columns[1]; // N° + ESTUDIANTE
    
    // Fondo gris para toda la fila
    fillRect(doc, positions[0], y, totalWidthAll, rowHeight, "#e6e6e6");
    
    // Bordes
    // Celda combinada (N° + ESTUDIANTE)
    strokeRect(doc, positions[0], y, firstTwoWidth, rowHeight);
    
    // Resto de celdas
    let tx3 = positions[2];
    for (let i = 2; i < columns.length; i++) {
      strokeRect(doc, tx3, y, columns[i], rowHeight);
      tx3 += columns[i];
    }
    
    // Texto centrado verticalmente
    const totalTextY = y + 7;
    
    doc.font("Helvetica-Bold").fontSize(10).fillColor("black");
    doc.text("TOTAL GENERAL", positions[0] + 4, totalTextY, { width: firstTwoWidth - 8, align: "center" });
    doc.text(formatNumber(totalCuotas), positions[2] + 3, totalTextY, { width: columns[2] - 6, align: "right" });
    doc.text(formatNumber(totalAbonos), positions[3] + 3, totalTextY, { width: columns[3] - 6, align: "right" });
    doc.text(formatNumber(totalSaldos), positions[4] + 3, totalTextY, { width: columns[4] - 6, align: "right" });
    doc.text(" ", positions[5] + 3, totalTextY, { width: columns[5] - 6, align: "center" });
    
    doc.moveDown(2);

    // =============================
    // TABLA DE TELLING-MATCH
    // =============================
    doc.font("Helvetica-Bold").fontSize(12);
    doc.text("TRANSACCIONES DE COBRO", 50, doc.y, { align: "left", width: 500 });
    doc.moveDown(1);

    const tMargin = 50;
    const tRowH = 22;
    const tCols = { n: 35, fecha: 69, estudiante: 135, banco: 101, comprobante: 90, valor: 65 };
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
          .text(h, tPos[i] + 4, yPos + 7.5, { width: Object.values(tCols)[i] - 8, align: "center" });
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
      const comp = String(row[3] || "");
      const valora = parseFloat(String(row[4]).replace(/[^\d.-]/g, "")) || 0;
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
        //drawTellingHeaders(ty);
        ty += tRowH;
      }
    
      // Fondo alterno
      if (i % 2 === 0) fillRect(doc, tPos[0], ty, 495, tRowH, "#fafafa");
    
      // Bordes de fila
      let tx2 = tPos[0];
      Object.values(tCols).forEach((cw) => { strokeRect(doc, tx2, ty, cw, tRowH); tx2 += cw; });
    
      // Texto en celdas
      const tTextY = ty + 7.5;
      doc.font("Helvetica").fontSize(9).fillColor("black");
      doc.text(String(i + 1), tPos[0] + 3, tTextY, { width: tCols.n - 6, align: "center" });
      doc.text(fecha, tPos[1] + 3, tTextY, { width: tCols.fecha - 6, align: "center" });
      doc.text(estudiante, tPos[2] + 4, tTextY, { width: tCols.estudiante - 8, align: "left" });
      doc.text(banco, tPos[3] + 4, tTextY, { width: tCols.banco - 8, align: "left" });
      doc.text(comp, tPos[4] + 4, tTextY, { width: tCols.comprobante - 8, align: "left" });
      doc.text(formatNumber(valora), tPos[5] + 3, tTextY, { width: tCols.valor - 6, align: "right" });
    
      ty += tRowH;
    });
    
    // ===================
    // TOTAL FINAL
    // ===================
    if (ty + tRowH > doc.page.height - 60) { doc.addPage(); ty = 50; }
    
    const totalWidth = Object.values(tCols).slice(0, 5).reduce((a, b) => a + b, 0); // ancho de las 5 primeras columnas
    
    // Fondo gris de ambas celdas
    fillRect(doc, tPos[0], ty, totalWidth + tCols.valor, tRowH, "#e6e6e6");
    
    // Bordes
    strokeRect(doc, tPos[0], ty, totalWidth, tRowH);        // celda combinada
    strokeRect(doc, tPos[5], ty, tCols.valor, tRowH);       // celda de valor
    
    // Texto centrado verticalmente
    const tTextY = ty + 7.5;
    
    doc.font("Helvetica-Bold").fontSize(9).fillColor("black");
    doc.text("TOTAL DE VALORES RECIBIDOS", tPos[0] + 4, tTextY, { width: totalWidth - 8, align: "right" });
    doc.text(formatNumber(totalValor), tPos[5] + 3, tTextY, { width: tCols.valor - 6, align: "right" });

    //GRAFICOS
    
    if (vagueRecords.length > 0) {
      const keys = Object.keys(vagueRecords[0]);
    
      const dataBarras = vagueRecords.map(row => ({
        nombre: String(row[keys[0]] ?? ""),
        valor: parseFloat(row[keys[4]] || 0)
      }));
    
      dataBarras.sort((a, b) => b.valor - a.valor);
    
      const totalGeneral = vagueRecords.reduce((s, r) => s + (parseFloat(r[keys[2]] || 0)), 0);
      const totalGasto = dataBarras.reduce((s, r) => s + r.valor, 0);
      const saldoDisponible = Math.max(0, totalGeneral - totalGasto);
    
      // ====== CONFIGURACIÓN CHART.JS ======
      const chartConfigBar = {
        type: "bar",
        data: {
          labels: dataBarras.map(d => d.nombre),
          datasets: [{
            label: "Gasto por estudiante",
            data: dataBarras.map(d => d.valor),
            backgroundColor: "rgba(54,162,235,0.7)",
            borderColor: "rgba(54,162,235,1)",
            borderWidth: 1
          }]
        },
        options: {
          plugins: {
            legend: { display: false },
            title: {
              display: true,
              text: "GASTOS POR ESTUDIANTE",
              font: { size: 16 }
            }
          },
          scales: {
            x: {
              ticks: {
                maxRotation: 45,
                minRotation: 45,
                color: "#333",
                font: { size: 9 }
              },
              grid: { display: false }
            },
            y: {
              beginAtZero: true,
              ticks: { color: "#333" },
              grid: { color: "#ddd" }
            }
          }
        }
      };
    
      const chartConfigPie = {
        type: "pie",
        data: {
          labels: [...dataBarras.map(d => d.nombre), "Saldo disponible"],
          datasets: [{
            data: [...dataBarras.map(d => d.valor), saldoDisponible],
            backgroundColor: [
              "#36A2EB","#FF6384","#FFCE56","#4BC0C0",
              "#9966FF","#FF9F40","#C9CBCF","#A3E1D4",
              "#F7A6A6","#89CFF0","#FFD580","#B0E57C"
            ]
          }]
        },
        options: {
          plugins: {
            title: {
              display: true,
              text: "DISTRIBUCIÓN DE GASTOS Y SALDO DISPONIBLE",
              font: { size: 16 }
            },
            legend: {
              position: "bottom",
              labels: { font: { size: 9 } }
            }
          }
        }
      };
    
      // ====== URLs de imágenes QuickChart ======
      const urlBar = "https://quickchart.io/chart?width=800&height=350&format=png&c=" +
                     encodeURIComponent(JSON.stringify(chartConfigBar));
      const urlPie = "https://quickchart.io/chart?width=600&height=300&format=png&c=" +
                     encodeURIComponent(JSON.stringify(chartConfigPie));
    
      // ====== Agregar al PDF ======
      doc.addPage();
      doc.font("Helvetica-Bold").fontSize(14).text("GRÁFICOS DE GASTOS", { align: "center" });
      doc.moveDown(1);
    
      const imgBar = await fetch(urlBar).then(r => r.arrayBuffer());
      const imgPie = await fetch(urlPie).then(r => r.arrayBuffer());
    
      // Inserta el primero
      const barY = doc.y;
      doc.image(Buffer.from(imgBar), 60, barY, { fit: [480, 250], align: "center" });
    
      // Espaciado entre gráficos
      const nextY = barY + 280;
      doc.image(Buffer.from(imgPie), 100, nextY, { fit: [400, 250], align: "center" });
    
      doc.moveDown(6);
    }


  
    
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
