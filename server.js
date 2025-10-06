import express from "express";
import axios from "axios";
import PDFDocument from "pdfkit";
import dayjs from "dayjs";

const app = express();
const port = process.env.PORT || 3000;

// 🧩 Función para leer CSV y convertirlo a matriz
async function leerCSV(url) {
  const resp = await axios.get(url);
  const lineas = resp.data.trim().split("\n");
  return lineas.map((l) => l.split(","));
}

// 🧾 Endpoint principal
app.get("/pdf", async (req, res) => {
  try {
    const urlsParam = req.query.url;
    if (!urlsParam) {
      return res.status(400).send("❌ Debes proporcionar las URLs de los archivos CSV en el parámetro ?url=");
    }

    // Separar las URLs por coma
    const urls = urlsParam.split(",");

    // Buscar el CSV que contenga "brawny-letters.csv"
    const urlBrawny = urls.find((u) => u.includes("brawny-letters.csv"));
    if (!urlBrawny) {
      return res.status(404).send("❌ No se encontró el archivo 'brawny-letters.csv' entre las URLs enviadas.");
    }

    // Leer datos del CSV
    const csvData = await leerCSV(urlBrawny);
    if (csvData.length < 2) {
      return res.status(400).send("❌ El archivo CSV no tiene suficientes filas para generar el reporte.");
    }

    // Obtener encabezados y valores
    const headers = csvData[0];
    const filaDatos = csvData[1];

    // Convertir los valores numéricos
    const valores = filaDatos.map((v) => parseFloat(v.replace(",", ".")));
    const [valRecibidos, valEntregados, saldoTotal] = valores;

    // Función de formato de número con separador de miles y decimales
    const formatoNum = (n) =>
      isNaN(n)
        ? "0,00"
        : n.toLocaleString("es-EC", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          });

    // Crear documento PDF
    const doc = new PDFDocument({ margin: 50 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=reporte_transacciones.pdf");

    // Canalizar la salida directamente a la respuesta HTTP
    doc.pipe(res);

    // === CONTENIDO DEL PDF ===

    // Título principal
    doc.font("Helvetica-Bold").fontSize(18).text("REPORTE DE TRANSACCIONES", { align: "center" });
    doc.moveDown(1.5);

    // Datos del encabezado
    doc.fontSize(12);
    doc.font("Helvetica").text("TESORERO: ", { continued: true }).font("Helvetica-Bold").text("JUAN PABLO BARBA MEDINA");
    doc.font("Helvetica").text("FECHA DEL INFORME: ", { continued: true }).font("Helvetica-Bold").text(dayjs().format("DD/MM/YYYY"));
    doc.moveDown(1);

    // Sección: Resumen Ejecutivo
    doc.font("Helvetica-Bold").fontSize(14).text("RESUMEN EJECUTIVO");
    doc.moveDown(0.5);
    doc.font("Helvetica").fontSize(12);
    doc.text(`VALORES RECIBIDOS (+): ${formatoNum(valRecibidos)}`);
    doc.text(`VALORES ENTREGADOS (-): ${formatoNum(valEntregados)}`);
    doc.text(`SALDO TOTAL (=): ${formatoNum(saldoTotal)}`);

    // Finalizar documento
    doc.end();
  } catch (err) {
    console.error("❌ Error generando PDF:", err.message);
    res.status(500).send("❌ Error interno al generar el PDF.");
  }
});

// 🚀 Iniciar servidor
app.listen(port, () => {
  console.log(`✅ Servidor ejecutándose correctamente en el puerto ${port}`);
});
