import express from "express";
import fetch from "node-fetch";
import PDFDocument from "pdfkit";

const app = express();

app.get("/generar-reporte", async (req, res) => {
  try {
    const urls = req.query.url?.split(",") || [];
    if (!urls.length) return res.status(400).send("Faltan URLs");

    // Import dinámico
    const csv = (await import("csvtojson")).default;

    // Descargar CSVs
    const csvData = await Promise.all(urls.map(async (url) => {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`No se pudo obtener CSV: ${url}`);
      const text = await resp.text();
      return csv().fromString(text);
    }));

    // brawny-letters
    const brawny = csvData.find((_, i) => urls[i].includes("brawny-letters")) || [];
    const rowB = brawny[0] || {};
    const keysB = Object.keys(rowB);
    const saldo = parseFloat(rowB[keysB[2]] || 0);

    // vague-stage
    const vague = csvData.find((_, i) => urls[i].includes("vague-stage")) || [];

    // Crear PDF
    const doc = new PDFDocument({ margin: 50 });
    const buffers = [];
    doc.on("data", buffers.push.bind(buffers));
    doc.on("end", () => {
      const pdfData = Buffer.concat(buffers);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", "attachment; filename=reporte.pdf");
      res.send(pdfData);
    });

    // Encabezado
    doc.font("Helvetica-Bold").fontSize(18).text("REPORTE DE TRANSACCIONES", { align: "center" });
    doc.moveDown();
    doc.font("Helvetica-Bold").text("SALDO TOTAL (=):", { continued: true }).font("Helvetica-Bold").text(` ${saldo}`);

    doc.moveDown().moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown();

    // Tabla simple para vague-stage
    const rowHeight = 20;
    const colPos = [60, 250, 320, 400, 470];
    const colWidth = [190, 70, 70, 70, 90];
    const headers = ["ESTUDIANTE","CUOTAS","ABONOS","SALDOS","ESTADO"];
    doc.font("Helvetica-Bold");
    headers.forEach((h,i)=> doc.text(h, colPos[i], doc.y, { width: colWidth[i], align:"center" }));
    doc.moveDown(0.5);

    let y = doc.y;
    let totalSaldos = 0;

    vague.forEach((r,index)=>{
      const keys = Object.keys(r);
      const est = r[keys[0]]; 
      const cuotas = parseFloat(r[keys[1]]||0);
      const abonos = parseFloat(r[keys[2]]||0);
      const saldoRow = parseFloat(r[keys[3]]||0);
      const estado = (r[keys[5]]||"").toUpperCase();
      totalSaldos += saldoRow;

      doc.font("Helvetica").fillColor(
        estado==="POR COBRAR"?"red":estado==="REVISAR"?"blue":"black"
      );

      doc.text(est,colPos[0],y,{width:colWidth[0],align:"left"});
      doc.text(cuotas.toFixed(2),colPos[1],y,{width:colWidth[1],align:"right"});
      doc.text(abonos.toFixed(2),colPos[2],y,{width:colWidth[2],align:"right"});
      doc.text(saldoRow.toFixed(2),colPos[3],y,{width:colWidth[3],align:"right"});
      doc.text(estado,colPos[4],y,{width:colWidth[4],align:"center"});

      y+=rowHeight;
    });

    // Total al final
    doc.font("Helvetica-Bold").fillColor("black");
    doc.text(`TOTAL SALDOS: ${totalSaldos.toFixed(2)}`, colPos[3], y, { align:"right" });

    // Finalizar PDF
    doc.end();

  } catch(e){
    console.error(e);
    res.status(500).send(`Error generando PDF: ${e.message}`);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>console.log(`Servidor en puerto ${PORT}`));
