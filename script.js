"use strict";

// Elementos de la interfaz.
const formulario = document.getElementById("formulario-chat");
const entrada = document.getElementById("entrada-mensaje");
const botonEnviar = document.getElementById("boton-enviar");
const mensajes = document.getElementById("mensajes");
const estadoChat = document.getElementById("estado-chat");
const contador = document.getElementById("contador");

// Configuración de seguridad y tiempos.
const TIEMPO_LIMITE = 30000;
const ESPERA_ENTRE_ENVIOS = 1500;
const MAX_CARACTERES = 500;
const CLAVE_SESION = "consultor_medico_session_id";

let enviando = false;
let ultimoEnvio = 0;
let mensajeCarga = null;
let sessionIdMemoria = null;

// Generar o recuperar el identificador único de sesión.
function obtenerSessionId() {
  if (sessionIdMemoria) {
    return sessionIdMemoria;
  }

  try {
    const guardado = localStorage.getItem(CLAVE_SESION);
    if (guardado) {
      sessionIdMemoria = guardado;
      return guardado;
    }
  } catch (error) {
    // Continuar usando memoria si localStorage no está disponible.
  }

  const nuevoId = (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

  sessionIdMemoria = nuevoId;

  try {
    localStorage.setItem(CLAVE_SESION, nuevoId);
  } catch (error) {
    // Ignorar error de almacenamiento.
  }

  return nuevoId;
}

const sessionId = obtenerSessionId();

// Verificar si la URL del webhook está configurada.
function webhookConfigurado() {
  if (typeof WEBHOOK_URL !== "string") return false;
  const url = WEBHOOK_URL.trim();
  if (!url || url.includes("ACA VA") || url.includes("ejemplo-webhook-prueba")) {
    return false;
  }
  return true;
}

// Mostrar la hora local de un mensaje.
function obtenerHora() {
  return new Intl.DateTimeFormat("es-AR", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date());
}

// Crear mensajes usando textContent para evitar insertar HTML externo.
function agregarMensaje(texto, tipo) {
  const articulo = document.createElement("article");
  articulo.className = `mensaje mensaje-${tipo}`;

  const contenido = document.createElement("div");
  contenido.className = "contenido-mensaje";

  const nombre = document.createElement("span");
  nombre.className = "nombre-emisor";
  nombre.textContent = tipo === "usuario"
    ? "Vos"
    : "Consultor Médico";

  const burbuja = document.createElement("div");
  burbuja.className = "burbuja";
  burbuja.textContent = texto;

  const hora = document.createElement("time");
  hora.className = "hora-mensaje";
  hora.textContent = obtenerHora();
  hora.dateTime = new Date().toISOString();

  contenido.append(nombre, burbuja, hora);
  articulo.appendChild(contenido);

  // Colocar el mensaje en el chat.
  mensajes.appendChild(articulo);
  mensajes.scrollTop = mensajes.scrollHeight;

  return articulo;
}

// Mostrar y ocultar estados informativos.
function mostrarEstado(texto) {
  estadoChat.textContent = texto;
}

function mostrarCarga() {
  mensajeCarga = agregarMensaje("Estoy procesando tu consulta...", "agente");
  mensajeCarga.setAttribute("aria-label", "Respuesta en proceso");
  mostrarEstado("Esperando la respuesta del asistente...");
}

function quitarCarga() {
  if (mensajeCarga) {
    mensajeCarga.remove();
    mensajeCarga = null;
  }
}

// Adaptar la altura del campo a su contenido.
function ajustarEntrada() {
  entrada.style.height = "auto";
  entrada.style.height = `${Math.min(entrada.scrollHeight, 120)}px`;
}

// Actualizar el contador de caracteres.
function actualizarContador() {
  contador.textContent = `${entrada.value.length}/${MAX_CARACTERES}`;
}

entrada.addEventListener("input", () => {
  ajustarEntrada();
  actualizarContador();
});

// Enviar con Enter y permitir saltos de línea con Shift + Enter.
entrada.addEventListener("keydown", (evento) => {
  if (evento.key === "Enter" && !evento.shiftKey && !evento.isComposing) {
    evento.preventDefault();

    if (formulario.requestSubmit) {
      formulario.requestSubmit();
    }
  }
});

// Limpiar bloques Markdown (```json ... ```) del texto recibido.
function limpiarMarkdown(texto) {
  return texto
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

// Buscar el primer campo válido en el objeto analizado.
function buscarCampoRespuesta(objeto) {
  const campos = ["response", "respuesta", "message", "mensaje"];
  for (const campo of campos) {
    if (typeof objeto[campo] === "string" && objeto[campo].trim()) {
      return objeto[campo].trim();
    }
  }
  return "Make respondió, pero sin el campo response";
}

// Extraer respuesta si el JSON tiene saltos de línea sin escapar.
function recuperarJsonMalformado(texto) {
  try {
    const escapado = texto.replace(/\r?\n/g, "\\n");
    const datos = JSON.parse(escapado);
    if (datos && typeof datos === "object" && !Array.isArray(datos)) {
      return buscarCampoRespuesta(datos);
    }
  } catch (error) {
    // Si sigue fallando, intentar extraer por expresión regular.
  }

  const campos = ["response", "respuesta", "message", "mensaje"];
  for (const campo of campos) {
    const regex = new RegExp(`"${campo}"\\s*:\\s*"([\\s\\S]*?)"\\s*(?:,|\\})`);
    const coincidencia = texto.match(regex);
    if (coincidencia && coincidencia[1].trim()) {
      return coincidencia[1].replace(/\\n/g, "\n").trim();
    }
  }

  return "Make respondió, pero sin el campo response";
}

// Procesar la respuesta en texto plano o JSON de Make.
function procesarTextoRespuesta(textoCrudo) {
  const limpio = limpiarMarkdown(textoCrudo);
  if (!limpio) {
    return "(respuesta vacía)";
  }

  try {
    const datos = JSON.parse(limpio);
    if (datos !== null && typeof datos === "object" && !Array.isArray(datos)) {
      return buscarCampoRespuesta(datos);
    }
    return limpio;
  } catch (error) {
    if (limpio.startsWith("{") && limpio.endsWith("}")) {
      return recuperarJsonMalformado(limpio);
    }
    return limpio;
  }
}

// Solicitar una respuesta al webhook.
async function consultarAgente(mensaje) {
  const controlador = new AbortController();
  const temporizador = setTimeout(
    () => controlador.abort(),
    TIEMPO_LIMITE
  );

  try {
    const respuesta = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        sessionId,
        mensaje,
        fecha: new Date().toISOString()
      }),
      signal: controlador.signal
    });

    const texto = (await respuesta.text()).trim();

    if (!respuesta.ok) {
      const errorServidor = new Error(
        `Make respondió con error (código ${respuesta.status}). Revisá que tu escenario esté en Active o que hayas apretado Run once.`
      );
      errorServidor.esErrorServidor = true;
      throw errorServidor;
    }

    if (!texto) {
      return "(respuesta vacía)";
    }

    return procesarTextoRespuesta(texto);
  } finally {
    clearTimeout(temporizador);
  }
}

// Controlar el envío y todos sus estados.
formulario.addEventListener("submit", async (evento) => {
  evento.preventDefault();

  if (enviando) return;

  // Validar configuración de la URL antes de hacer el envío.
  if (!webhookConfigurado()) {
    mostrarEstado("Falta pegar la URL de tu webhook en config.js");
    return;
  }

  const texto = entrada.value.trim();

  if (!texto) {
    mostrarEstado("Escribí una consulta antes de enviar.");
    entrada.focus();
    return;
  }

  if (texto.length > MAX_CARACTERES) {
    mostrarEstado(`La consulta supera el límite de ${MAX_CARACTERES} caracteres.`);
    return;
  }

  // Aplicar una espera mínima de 1,5 segundos entre envíos.
  const ahora = Date.now();
  if (ahora - ultimoEnvio < ESPERA_ENTRE_ENVIOS) {
    mostrarEstado("Esperá un instante antes de volver a enviar.");
    return;
  }

  // Bloquear controles mientras se procesa la consulta.
  enviando = true;
  ultimoEnvio = Date.now();
  botonEnviar.disabled = true;
  entrada.disabled = true;

  agregarMensaje(texto, "usuario");
  entrada.value = "";
  ajustarEntrada();
  actualizarContador();
  mostrarCarga();

  try {
    const respuesta = await consultarAgente(texto);

    quitarCarga();
    agregarMensaje(respuesta, "agente");
    mostrarEstado("Respuesta recibida correctamente.");
  } catch (error) {
    quitarCarga();

    if (error.name === "AbortError") {
      agregarMensaje(
        "Tiempo de espera agotado (30 segundos). Intentá nuevamente.",
        "agente"
      );
      mostrarEstado("Error: tiempo agotado.");
    } else if (error.esErrorServidor) {
      agregarMensaje(error.message, "agente");
      mostrarEstado("Error del servidor de Make.");
    } else {
      console.error("Error de red:", error);
      agregarMensaje(
        "Error de red: no se pudo conectar con Make. Revisá tu conexión a internet.",
        "agente"
      );
      mostrarEstado("Error de conexión.");
    }
  } finally {
    // Restaurar controles pase lo que pase.
    quitarCarga();
    enviando = false;
    botonEnviar.disabled = false;
    entrada.disabled = false;
    entrada.focus();
    mensajes.scrollTop = mensajes.scrollHeight;
  }
});

// Preparar el campo y verificar configuración al cargar.
actualizarContador();
ajustarEntrada();
if (!webhookConfigurado()) {
  mostrarEstado("Falta pegar la URL de tu webhook en config.js");
}
entrada.focus();
