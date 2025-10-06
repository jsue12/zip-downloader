import express from "express";
import fetch from "node-fetch";
import archiver from "archiver";

const app = express();

app.get("/zip", async (req, res) => {
  try {
    const urls = (req.query.url || "").split(",").map(u => u.trim()).filter(u => u);
    if (!urls.length) {
      return res.status(400).send("Falta el parámetro ?url=");
    }

    // Configurar cabeceras de descarga
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", "attachment; filename=archivos_csv.zip");

    const archive = archiver("zip");
    archive.pipe(res);

    // Descargar cada CSV y agregarlo al ZIP
    for (let i = 0; i < urls.length; i++) {
      const u = urls[i];
      const response = await fetch(u);
      const buffer = await response.arrayBuffer();
      const name = u.split("/").pop() || `archivo_${i + 1}.csv`;
      archive.append(Buffer.from(buffer), { name });
    }

    await archive.finalize();
  } catch (error) {
    console.error(error);
    res.status(500).send("Error al generar el ZIP");
  }
});

app.listen(8080, () => console.log("Servidor iniciado en http://localhost:8080/zip?url="));
