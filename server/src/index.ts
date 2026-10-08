import { app } from "./app.js";
import { config } from "./config.js";

app.listen(config.port, () => {
  console.log(`API Dental-3D escuchando en http://localhost:${config.port}`);
});
