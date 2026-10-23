
"use strict";

// Elementos de la interfaz.
const formulario = document.getElementById("formulario-chat");
const entrada = document.getElementById("entrada-mensaje");
const botonEnviar = document.getElementById("boton-enviar");
const mensajes = document.getElementById("mensajes");
const estadoChat = document.getElementById("estado-chat");
const contador = document.getElementById("contador");

// Configuración de seguridad y tiempos.
const TIEMPO_LIMITE = 20000;
const ESPERA_ENTRE_ENVIOS = 1200;
const MAX_CARACTERES = 2000;

let enviando = false;
let ultimoEnvio = 0;
let mensajeCarga = null;

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

// Obtener el texto de respuesta del webhook.
function extraerRespuesta(datos) {
  if (typeof datos === "string" && datos.trim()) {
    return datos.trim();
  }

  if (datos && typeof datos === "object") {
    const posiblesCampos = [
      "respuesta",
      "response",
      "mensaje",
      "message",
      "output",
      "text"
    ];

    for (const campo of posiblesCampos) {
      if (
        typeof datos[campo] === "string" &&
        datos[campo].trim()
      ) {
        return datos[campo].trim();
      }
    }
  }

  throw new Error("El webhook no devolvió una respuesta válida.");
}

// Solicitar una respuesta al webhook.
async function consultarAgente(texto) {
  const controlador = new AbortController();
  const temporizador = setTimeout(
    () => controlador.abort(),
    TIEMPO_LIMITE
  );

  try {
    const respuesta = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        mensaje: texto,
        agente: "consultor medico",
        fecha: new Date().toISOString()
      }),
      signal: controlador.signal
    });

    if (!respuesta.ok) {
      throw new Error(`Error HTTP ${respuesta.status}.`);
    }

    const tipoContenido = respuesta.headers.get("content-type") || "";
    let datos;

    if (tipoContenido.includes("application/json")) {
      datos = await respuesta.json();
    } else {
      datos = await respuesta.text();
    }

    return extraerRespuesta(datos);
  } finally {
    clearTimeout(temporizador);
  }
}

// Controlar el envío y todos sus estados.
formulario.addEventListener("submit", async (evento) => {
  evento.preventDefault();

  // Impedir envíos simultáneos o mensajes vacíos.
  if (enviando) return;

  const texto = entrada.value.trim();

  if (!texto) {
    mostrarEstado("Escribí una consulta antes de enviar.");
    entrada.focus();
    return;
  }

  if (texto.length > MAX_CARACTERES) {
    mostrarEstado("La consulta supera el límite permitido.");
    return;
  }

  // Aplicar una espera mínima entre envíos.
  const ahora = Date.now();
  const tiempoTranscurrido = ahora - ultimoEnvio;

  if (tiempoTranscurrido < ESPERA_ENTRE_ENVIOS) {
    mostrarEstado("Esperá un instante antes de volver a enviar.");
    return;
  }

  // Bloquear el botón mientras se procesa la consulta.
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
        "La consulta tardó demasiado en responder. Intentá nuevamente.",
        "agente"
      );
      mostrarEstado("Tiempo de espera agotado.");
    } else {
      console.error("Error al consultar el agente:", error);

      agregarMensaje(
        "No pude obtener una respuesta en este momento. " +
        "Verificá la conexión del webhook e intentá nuevamente.",
        "agente"
      );
      mostrarEstado("No se pudo completar la consulta.");
    }
  } finally {
    // Restaurar los controles incluso si ocurre un error.
    quitarCarga();
    enviando = false;
    botonEnviar.disabled = false;
    entrada.disabled = false;
    entrada.focus();
    mensajes.scrollTop = mensajes.scrollHeight;
  }
});

// Preparar el campo al cargar la página.
actualizarContador();
ajustarEntrada();
entrada.focus();
