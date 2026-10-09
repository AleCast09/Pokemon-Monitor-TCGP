; _ZonasNeedles.ahk
; Busqueda de needles ACOTADA a su zona, al estilo de Kevin (su Coords.ahk: cada needle con su
; rectangulo). Agregado 2026-09-26 a pedido de Ale, tras ver funcionar el farmeo de likes con
; este mismo mecanismo.
;
; Por que: buscar en pantalla completa obliga a que el needle sea unico en TODA la pantalla, y
; eso fue la raiz de varios bugs reales del auto trade (un needle matcheando dos pantallas
; distintas, o un parche de color liso matcheando cualquier cosa del mismo tono). Acotado, el
; needle solo tiene que coincidir EN SU LUGAR.
;
; Como se llena la tabla: no se adivina. Mientras un needle no tiene zona, se busca en pantalla
; completa como siempre (cero cambio de comportamiento) y cada match anota donde lo encontro en
; Logs\_calibracion_zonas.txt. Con un tradeo real se sacan las posiciones exactas y se pasan a
; la tabla de abajo; desde ahi ese needle busca SOLO en su zona.
;
; Las zonas estan en la escala de la captura donde se busca ese needle: 540x960 para las
; capturas ADB, y la nativa de la ventana para los needles con sufijo _native. Como cada needle
; tiene su propio nombre por escala, no se mezclan.

; Zona de un needle: "x1,y1,x2,y2" (el needle entero tiene que caber dentro), o "" si todavia
; no esta calibrado. La clave lleva el tamano de la captura ("nombre@540x960") porque algunos
; needles se buscan tanto en la pantalla entera como en un recorte: asi una zona nunca se aplica
; a una imagen de otro tamano.
zonaDeNeedle(clave) {
    static zonas := ""
    if (!IsObject(zonas)) {
        zonas := {}
        ; ---- Tabla de zonas (se completa con la calibracion) ----
        ; Calibradas paso a paso con Ale sobre capturas reales (2026-09-26). Margen de 12 px
        ; alrededor de donde matcheo el needle, en la escala nativa 275x528.
        ; Main acepta la solicitud de amistad (_MainAcceptFriendRequest.ahk):
        ; Estos tres needles se recortaron a 14x14 estilo Kevin (originales respaldados en
        ; _needles_retirados_2026-09-26), verificados unicos en toda la pantalla y sin match en
        ; las otras dos pantallas del paso.
        zonas["own_mainaccept_friends_icon_native@275x528"] := "11,440,49,478"     ; boton Amigos en Comunidad, match en (23,452)
        zonas["own_mainaccept_addfriend_icon_native@275x528"] := "225,94,263,132"  ; icono agregar amigo en la lista, match en (237,106)
        zonas["own_mainaccept_check_native@275x528"] := "219,184,257,222"          ; check de aceptar la 1a solicitud, match en (231,196)
        zonas["own_mainaccept_sin_solicitudes_native@275x528"] := "178,483,215,520" ; X gris de "Borrar todas" = lista vacia, match en (190,495)
        ; Mismo paso a escala ADB 540x960: recorte 26x26 y margen de 24 px.
        zonas["own_mainaccept_check@540x960"] := "431,286,505,360"                ; check de aceptar, match en (455,310)
        zonas["own_mainaccept_x_back@540x960"] := "233,868,307,942"               ; X de cerrar abajo al centro, match en (257,892)
        zonas["own_mainaccept_friends_icon@540x960"] := "37,778,111,852"          ; tile Amigos en Comunidad, match en (61,802)
        zonas["own_mainmenu_navbar_activo@540x960"] := "33,890,107,960"           ; casita de la barra de abajo, match en (57,914)
        ; La donante ofrece la carta (_DonorOfferCard.ahk):
        zonas["own_donoroffer_x_searchresults@540x960"] := "233,868,307,942"      ; X de abajo al centro (Search Results y siguientes), match en (257,892)
        ; Esquina superior izquierda del boton OK (la curva, sin la palabra). Lo usan 12
        ; diálogos distintos de varios scripts, por eso la zona es mas amplia: +-40 en X y
        ; +-60 en Y, por si la fila de botones queda mas arriba o mas abajo segun el dialogo.
        zonas["own_donoroffer_cancel_ok@540x960"] := "244,551,350,697"             ; match en (284,611) en Friend ID Search
        ; Tile Intercambio/Trade en Comunidad -- verificado igual en ingles y en espanol.
        zonas["own_donoroffer_trade_icon_native@275x528"] := "189,384,227,422"    ; match en (201,396)
        zonas["own_donoroffer_trade_icon@540x960"] := "378,660,452,734"           ; match en (402,684)
        ; Pantalla de Intercambio: el reloj de Historial (solo existe en esa pantalla). El
        ; needle nativo era la ilustracion grande 140x90 y NO matcheaba (diff 101): se reemplazo
        ; por el reloj 16x16, verificado en ingles y en espanol.
        zonas["own_maintrade_trade_button_native@275x528"] := "183,445,223,485"   ; match en (195,457)
        zonas["own_donoroffer_trade_button@540x960"] := "366,796,440,870"         ; match en (390,820)
        ; Select a Friend: la lupa + del primer amigo (sin pixeles de la foto de perfil). Ya
        ; tenian tamano Kevin, solo se les puso zona.
        zonas["own_donoroffer_selectfriend_trade_native@275x528"] := "57,153,98,194"  ; match en (69,165)
        zonas["own_donoroffer_selectfriend_trade@540x960"] := "114,222,184,292"       ; match en (138,246)
        ; Aviso "elige una carta": la punta de la flecha verde. El popup entra deslizandose,
        ; asi que la zona tiene margen extra (40 px) para frames todavia en movimiento.
        zonas["own_donoroffer_willsend_popup@540x960"] := "184,153,290,259"          ; match en (224,193)
        ; Perfil de Main: icono de Battle record. El icono cambia de tono (animado), por eso el
        ; needle es el color PROMEDIO de dos capturas: queda a 20-31 de cada extremo, holgado
        ; dentro de la tolerancia 60 que usa el script (el needle viejo llegaba a 68 y fallaba).
        zonas["own_donoroffer_userprofile_battlerecord_native@275x528"] := "114,329,152,367"  ; match en (126,341)
        ; Corazon de "View Wishlist": franja vertical, porque su altura depende de cuanto se
        ; deslizo el perfil. Solo trazo del corazon (13x12), sin el borde del boton.
        ; Ancho 30-160 porque el boton esta centrado y su ancho cambia con el idioma: el
        ; corazon se corre a los lados segun lo largo del texto.
        zonas["own_donoroffer_wishlist_heart_native@275x528"] := "30,40,160,528"  ; match en (77,404) en esta captura
        ; Corazon de "View Wishlist" a escala ADB (2026-09-28): la captura nativa esta reducida a la
        ; mitad y el trazo de 1 px cambia segun la posicion del scroll; a 540x960 siempre se ve igual.
        zonas["own_donoroffer_wishlist_heart_adb@540x960"] := "40,0,330,960"  ; match en (151,109)
        ; Carta abierta desde la wishlist: X de cerrar abajo y corazon arriba a la derecha (ADB;
        ; el viejo incluia la punta de las letras de "Wishlist", ahora es solo el corazon).
        zonas["own_donoroffer_wishlistcard_close_x_native@275x528"] := "119,482,157,520"  ; match en (131,494)
        zonas["own_donoroffer_wishlistcard_wishlistbtn_adb@540x960"] := "462,17,536,91"   ; match en (486,41)
        ; Estrella de favorito arriba a la derecha de la carta abierta (vacia y amarilla, mismo
        ; corte en las dos para que compartan el offset de toque +10,+6).
        zonas["own_donoroffer_userprofile_favoritestar_native@275x528"] := "204,47,242,85"         ; match en (216,59)
        zonas["own_donoroffer_userprofile_favoritestar_marked_native@275x528"] := "204,47,242,85"  ; match en (216,59)
        ; X de cerrar el perfil (plan B despues del boton Atras): el viejo incluia el trofeo de
        ; Achievements detras de la X, que cambia con el scroll y con cada cuenta, y no
        ; matcheaba. Ahora es la misma X sola que la de cerrar la carta.
        zonas["own_donoroffer_userprofile_close_x_native@275x528"] := "119,482,157,520"  ; match en (131,494)
        ; + de "Save Current Filters" en el panel de filtros. Se deja en 20x20 (ya es tamano
        ; Kevin): recortado a 14x14 era tan tenue que daba falsos matches.
        zonas["own_donoroffer_filterpanel_plusicon_native@275x528"] := "16,205,60,249"  ; match en (28,217)
        ; Boton Favorites marcado: esquina del boton oscuro (sin letras).
        zonas["own_donoroffer_favtoggle_selected_native@275x528"] := "11,301,49,339"  ; match en (23,313)
        ; Vista previa del envio (Trade Partner): borde del boton + sobre el fondo verde. El
        ; nativo viejo incluia un pedazo de la hojita verde de MuMu (esquina sup. derecha, desde
        ; x=245), que no aparece en todas las PCs: el recorte nuevo termina en x=241.
        zonas["own_donoroffer_tradepartner_header_native@275x528"] := "216,50,254,88"  ; match en (228,62)
        zonas["own_donoroffer_tradepartner_header@540x960"] := "458,35,532,109"        ; el ? de ayuda, match en (482,59)
        ; Dialogo "usar esta carta": mismo punto que el anterior pero con el fondo oscurecido
        ; por el dialogo. Tambien tenia la hojita de MuMu; recortado sin ella.
        zonas["own_donoroffer_setcard_confirm_native@275x528"] := "216,50,254,88"  ; match en (228,62)
        ; Aviso "te queda una sola copia": el 0 del contador "1 > 0" (numero, sin palabras).
        zonas["own_donoroffer_remainingcopy_popup@540x960"] := "265,543,339,617"  ; match en (289,567)
        ; Confirmacion final "ofreciste la carta": esquina del OK centrado de abajo. Todos los
        ; OK del juego tienen la misma esquina; lo que distingue este es la posicion, por eso
        ; aca la zona es lo importante (deja fuera los OK de los dialogos de dos botones).
        ; Ampliada hacia arriba (2026-09-27, error mio detectado con Ale): este mismo needle
        ; detecta el popup "tradeo cancelado / sin acuerdo", cuyo Vale esta en y=636. Con la zona
        ; original (713-787) ese popup quedaba afuera y la donante no lo iba a cerrar.
        ; Angosta en X a proposito: los matches correctos caen siempre en x=164, y el boton
        ; grande de la pantalla de Intercambio (falso, diff 42-47) cae en x=153 -- queda afuera.
        zonas["own_maintrade_offered_confirm@540x960"] := "158,630,196,769"  ; match en (164,737) confirmacion final y (164,636) popup sin acuerdo
        ; "Waiting for a Response": el icono de refrescar. El _icon viejo incluia el fondo verde
        ; (degradado que cambia) y quedaba al borde de la tolerancia (47 de 50); ahora los dos
        ; son solo el icono.
        zonas["own_donoroffer_waitingresponse_icon@540x960"] := "335,612,421,698"  ; match en (365,642)
        zonas["own_donoroffer_waitingresponse_pill@540x960"] := "335,612,421,698"  ; match en (365,642)
        ; Main con oferta pendiente: el "!" rojo del boton Ver (solo existe mientras la oferta
        ; siga sin resolver). Color promedio viejo/actual (el badge anima). La franja verde
        ; own_maintrade_offer_received_banner (60x8, verde plano) matcheaba 3789 veces y podia
        ; hacer tocar Ver sin oferta: reemplazada por este mismo "!".
        zonas["own_maintrade_ver_badge@540x960"] := "339,692,414,767"                   ; match en (363,716)
        zonas["own_maintrade_offer_received_banner@540x960"] := "339,692,414,767"       ; match en (363,716)
        zonas["own_maintrade_offer_received_banner_native@275x528"] := "173,393,210,430" ; match en (185,405)
        ; Main abrio la oferta (Rechazar/Intercambiar): el relojito del tiempo restante.
        zonas["own_maintrade_trade_button@540x960"] := "211,697,285,771"  ; match en (235,721)
        ; Main eligiendo su carta: la misma lupa que la donante, en la misma posicion.
        zonas["own_maintrade_choosecard_title_native@275x528"] := "224,130,262,168"  ; match en (236,142)
        zonas["own_maintrade_choosecard_title@540x960"] := "439,176,513,250"         ; match en (463,200)
        ; Panel "Ordenar" de Main: icono de carta con # de la primera fila.
        zonas["own_maintrade_sortpanel_icon@540x960"] := "432,315,506,389"  ; match en (456,339)
        ; Flecha arriba de "Por cantidad de cartas" (solo la flecha; el viejo incluia el borde
        ; del boton seleccionado).
        zonas["own_sort_up@540x960"] := "485,569,540,641"  ; match en (509,593)
        ; Vista previa de Main: mismos recortes que la donante (el nativo viejo de Main tambien
        ; incluia la hojita de MuMu).
        zonas["own_maintrade_tradepartner_header_native@275x528"] := "216,50,254,88"  ; match en (228,62)
        zonas["own_maintrade_tradepartner_header@540x960"] := "458,35,532,109"        ; match en (482,59)
        ; Donante en "Trade for This Card?": esquina del boton Trade. Los viejos eran la flecha
        ; verde decorativa del fondo (el ADB de 116x123 matcheaba 865 veces).
        zonas["own_donorfinalize_tradeforcard_title_native@275x528"] := "131,427,169,465"  ; match en (143,439)
        zonas["own_donorfinalize_tradeforcard_title@540x960"] := "253,760,327,834"         ; match en (277,784)
        ; Dialogo de finalizar (y cualquier Cancel/OK): esquina del OK en escala de ventana. El
        ; viejo era un parche del fondo oscurecido que dependia de la carta de detras. La zona
        ; deja fuera el boton Trade de "Trade for This Card?" (mas abajo, y=439).
        zonas["own_donorfinalize_confirm_native@275x528"] := "130,334,168,372"  ; match en (142,346)
        ; Pantalla del deslizamiento: esquina sup. derecha de la burbuja blanca de instruccion.
        ; Los viejos eran la flechita "^" animada sobre verde (382 y 1523 matches falsos).
        zonas["own_donorfinalize_swipe_instruction_native@275x528"] := "236,72,274,110"  ; match en (248,84)
        zonas["own_donorfinalize_swipe_instruction@540x960"] := "462,65,540,139"         ; match en (486,89)
        ; Pantalla final "Got it!": marco de la carta recibida sobre el fondo lila. Los viejos
        ; eran un parche celeste liso (ADB, 95794 matches) y una estrellita de rareza (nativo,
        ; solo servia si la carta era de rareza estrella). El nativo tiene poco contraste, por
        ; eso el script lo busca con tolerancia 10; recortado debajo del dragoncito del speed mod.
        zonas["own_donorfinalize_tap_to_proceed_native@275x528"] := "7,110,43,146"  ; match en (19,122)
        ; ADB: misma esquina del marco (22x22, debajo del dragoncito), tolerancia 10. Verificado
        ; en la donante (Hitmonlee, ingles) y en Main (Magmar, espanol): diff 0 en ambos.
        ; Fondo lila de la pantalla "Got it!" (2026-09-28, bug real en vivo con Ale): el needle de
        ; tap_to_proceed era la esquina de la letra G, y el icono flotante del speed mod quedo
        ; justo encima -- nunca coincidio. Parche de color liso a la derecha de la carta, sin
        ; letras; la pantalla del swipe ahi es verde, asi que no se confunden.
        ; Pantallas despues del "Got it!" (2026-10-01, desmarcar favoritas): needles de Kevin
        ; (Coords.ahk) con su misma zona y un margen de 6 px.
        zonas["own_donoroffer_choosecard_lupa_native@275x528"] := "227,131,259,163"   ; "Choose a Card": lupa de busqueda, match en (235,139)
        zonas["own_maintrade_sin_energia@540x960"] := "56,737,104,785"   ; vista previa sin energia de intercambio: triangulo rojo, match en (68,749)
        zonas["own_energia_popup_opcion1@540x960"] := "34,454,76,522"   ; popup de energia insuficiente: borde verde de la opcion 1, match en (46,466)
        zonas["own_energia_confirm_reloj@540x960"] := "178,547,224,604"   ; confirmar uso de relojes: icono del reloj (sin el numero), match en (190,559)
        zonas["own_energia_recuperada_flecha@540x960"] := "240,452,300,497"   ; popup "energia recuperada": flechita entre las dos barras, match en (252,464)
        zonas["own_thanks_avatar_lupa@540x960"] := "312,380,366,434"   ; "Send a thanks?": lupita del avatar, match en (326,394)
        zonas["own_share_landing_native@275x528"] := "28,341,62,375"   ; pantalla Share: icono verde de dos personas, match en (36,349)
        zonas["own_friends_lista_native@275x528"] := "227,97,261,131"   ; lista de Friends: icono "agregar amigo", match en (235,105)
        zonas["kevin_pack_skip_native@275x528"] := "239,489,262,513"     ; registrar en el dex (>|)
        zonas["kevin_pack_next_native@275x528"] := "125,68,146,90"       ; dex (pokebola del libro)
        zonas["kevin_getitem_dialog_native@275x528"] := "0,329,26,356"   ; "Items acquired"
        zonas["own_donorfinalize_gotit_bg@540x960"] := "500,590,540,640"
        zonas["own_donorfinalize_gotit_bg_native@275x528"] := "254,340,275,366"
        zonas["own_donorfinalize_tap_to_proceed@540x960"] := "10,139,80,209"        ; match en (34,163)
        ; Main con "acuerdo alcanzado": extremo izquierdo de la cinta CELESTE (en "oferta
        ; recibida" la cinta es verde, diff 111). La cinta esta centrada y su largo depende del
        ; texto/idioma, por eso la zona es ancha en X. El ADB viejo era una franja plana de 60x8
        ; (201 matches) y el nativo viejo no matcheaba.
        zonas["own_maintrade_agreement_reached_native@275x528"] := "20,313,120,351"  ; match en (61,325)
        zonas["own_maintrade_agreement_reached@540x960"] := "40,533,240,607"         ; match en (123,557)
        ; Boton Actualizar de Main (mismo icono de refrescar que la pantalla de espera).
        zonas["own_maintrade_refresh_button_native@275x528"] := "171,353,209,391"  ; match en (183,365)
        zonas["own_maintrade_refresh_button@540x960"] := "335,612,421,698"         ; match en (365,642)
        ; Dragoncito del speed mod: NO se achica a proposito. Es semitransparente y animado, sus
        ; pixeles se mezclan con el fondo de cada pantalla (un recorte 16x16 solo matcheo en 2
        ; de 10 pantallas). Se deja el 40x55 con su tolerancia alta y solo se acota la zona: el
        ; icono esta siempre arriba a la izquierda (el script lo toca en 18,109 fijo).
        zonas["own_speedmod_icon@275x528"] := "0,30,60,150"  ; match en (0,50)
        ; Panel del speed mod ABIERTO: el engranaje azul de arriba a la derecha (como Kevin:
        ; se toca el dragoncito a ciegas y se confirma con un needle chico del panel).
        zonas["own_speedmod_panel_gear_native@275x528"] := "172,69,210,107"  ; match en (184,81)
        zonas["own_speedmod_panel_gear@540x960"] := "339,58,413,132"         ; match en (363,82)
        ; Pantalla de titulo (Tap to Start): las rayas del boton de menu de arriba a la derecha,
        ; sin el fondo animado. Reemplaza a la franja roja del logo (132 matches en ADB, 87 en
        ; nativo). Lo usan todos los scripts del tradeo para detectar que el juego se cerro y
        ; volvio al titulo (tolerancia 75), y el arranque de Main para tocar Start. Probado
        ; contra 103 capturas: solo matchea en el titulo; la siguiente mas parecida da 90 (ADB)
        ; y 74 (nativo). El nativo arranca en y=71 para no rozar la hojita de MuMu.
        zonas["own_tapstart_logo@540x960"] := "455,36,535,106"         ; match en (479,60)
        zonas["own_tapstart_logo_native@275x528"] := "231,59,267,95"   ; match en (243,71)
        ; Popup "tradeo cancelado / sin acuerdo" en Main: esquina del boton Vale (sin letras).
        ; Los otros Vale/OK del juego caen en otras posiciones y quedan fuera de la zona.
        zonas["own_maintrade_sinacuerdo_popup_native@275x528"] := "70,351,108,389"  ; match en (82,363)
        ; Casita de la barra de abajo, en sus dos estados. ENCENDIDA (rellena) = estas en el menu
        ; principal; APAGADA (contorno) = cualquier otra pantalla con barra. Verificados: cada uno
        ; solo matchea en su estado.
        zonas["own_mainmenu_navbar@540x960"] := "33,890,107,960"          ; encendida, match en (57,914)
        zonas["own_mainmenu_navbar_native@275x528"] := "15,492,53,528"    ; apagada, match en (27,504)
        ; own_mainmenu_navbar_home (apagada, ADB) usa la zona fija que le pasa el codigo (35,895,105,960).
        ; Ventana de Noticias al arrancar: solo la X de cerrar (sin palabras). Es la misma X de
        ; las listas pero mas arriba (y=852 contra y=892); la zona deja afuera la de y=892, asi
        ; una lista de amigos o de busqueda no se confunde con una noticia. Lo usan el arranque
        ; de Main y el de la donante.
        zonas["own_news_x@540x960"] := "233,828,307,880"  ; match en (257,852)
        ; Popup "el juego se ha cerrado mientras se abria un sobre": esquina del boton Vale (sin
        ; letras). El viejo era el texto en ingles "The game closed, but you successfully obtained
        ; the items" y no reconocia la version en espanol. El toque (150,369) cae en el Vale.
        zonas["own_gameclosed@540x960"] := "150,591,200,641"          ; match en (162,603)
        zonas["own_gameclosed_native@275x528"] := "70,334,108,372"    ; match en (82,346)
        ; Tile Trade con "No trade agreement reached" (tradeo cancelado): el "!" rojo del tile, sin
        ; letras. La cinta tapa el icono normal del tile, por eso el script busca "icono O este
        ; badge". Ya tenia tamano Kevin (20x18); solo se le puso zona.
        zonas["own_donoroffer_notradeagreement_badge_native@275x528"] := "241,366,275,408"  ; match en (253,378)
        ; Escritorio de Android (juego cerrado): el engranaje de Configuracion del dock de MuMu, un
        ; icono del sistema. El viejo era un pedazo del FONDO DE PANTALLA, que cambia si otra PC
        ; tiene otro fondo. Lo usan los flujos que todavia arrancan la donante con la bienvenida.
        zonas["own_android_home_desktop@540x960"] := "112,867,186,941"  ; match en (136,891)
        ; Pantalla "Player's Featured" abierta por error en el perfil: icono del ojo tachado de
        ; "Hide Buttons" (sin letras). Unico en toda la pantalla (la siguiente mas parecida da 72).
        zonas["own_donoroffer_featured_hide_native@275x528"] := "186,482,224,520"  ; match en (198,494)
        ; Flecha de volver del detalle de un sobre (solo la flecha). OJO: es identica y en el mismo
        ; lugar que la de la pantalla de Intercambio. Aceptado a proposito: solo se revisa al
        ; empezar el paso 2 (Main acepta la solicitud), y si se toca estando en Intercambio, Main
        ; vuelve a Comunidad, que es justo a donde tiene que ir ese paso. El viejo (60x60) incluia
        ; fondo y ya no matcheaba (diff 32).
        zonas["own_boosterdetail_back_button@540x960"] := "233,799,307,873"  ; match en (257,823)
        ; Donante en Intercambio con "Trade response received": el "!" del boton View, el mismo que
        ; usa Main. El ADB viejo era el "?" de ayuda, que esta en TODAS las pantallas de Intercambio;
        ; como el script toca View (141,416) al verlo, en un Intercambio sin respuesta ese punto es
        ; el boton "Trade" y habria empezado un tradeo nuevo.
        zonas["own_donorfinalize_waiting_title@540x960"] := "339,692,414,767"          ; match en (363,716)
        zonas["own_donorfinalize_waiting_title_native@275x528"] := "173,393,210,430"   ; match en (185,405)
        ; Popup "se ha llegado a un acuerdo, se va a regresar al menu Intercambio" (Main, paso 6).
        ; ADB: la esquina del Vale (mismo lugar y mismo needle que el de juego cerrado, color
        ; promedio porque el boton "respira", tolerancia 45). El viejo era un parche celeste liso
        ; de 80x48 que ni siquiera matcheaba (110). Nativo: el "?" de ayuda OSCURECIDO por el popup
        ; (el "?" normal sin popup da 29, fuera de la tolerancia 20).
        zonas["own_maintrade_already_agreed_ok@540x960"] := "150,591,200,641"          ; match en (162,603)
        zonas["own_maintrade_already_agreed_ok_native@275x528"] := "235,120,273,158"   ; match en (247,132)
        ; Choose a Card: la lupa de busqueda junto a la barra del contador.
        zonas["own_donoroffer_choosecard_title_native@275x528"] := "224,130,262,168"  ; match en (236,142)
        zonas["own_donoroffer_choosecard_title@540x960"] := "439,176,513,250"         ; match en (463,200)
    }
    return zonas.HasKey(clave) ? zonas[clave] : ""
}

; Reemplazo directo de Gdip_ImageSearch(pHay, pNeedle, vPos, 0, 0, 0, 0, variation).
; Devuelve lo mismo que Gdip_ImageSearch (1 = encontrado).
buscarNeedleZonal(pHay, pNeedle, ByRef vPos, variation, nombre) {
    Gdip_GetImageDimensions(pHay, hW, hH)
    z := zonaDeNeedle(nombre . "@" . hW . "x" . hH)
    if (z != "") {
        p := StrSplit(z, ",")
        return Gdip_ImageSearch(pHay, pNeedle, vPos, p[1], p[2], p[3], p[4], variation)
    }
    r := Gdip_ImageSearch(pHay, pNeedle, vPos, 0, 0, 0, 0, variation)
    if (r = 1)
        anotarPosicionNeedle(nombre, vPos, pHay, pNeedle)
    return r
}

; Anota la posicion de un match (una sola vez por needle y por corrida, para que el archivo no
; crezca sin control). Formato: nombre|x|y|anchoNeedle|altoNeedle|anchoCaptura|altoCaptura|script
anotarPosicionNeedle(nombre, vPos, pHay, pNeedle) {
    static anotados := {}
    Gdip_GetImageDimensions(pHay, hW, hH)
    clave := nombre . "@" . hW . "x" . hH
    if (nombre = "" || anotados.HasKey(clave))
        return
    anotados[clave] := true
    try {
        xy := StrSplit(vPos, ",")
        Gdip_GetImageDimensions(pNeedle, nW, nH)
        FileAppend, % nombre . "|" . xy[1] . "|" . xy[2] . "|" . nW . "|" . nH . "|" . hW . "|" . hH . "|" . A_ScriptName . "`n", % A_ScriptDir . "\Logs\_calibracion_zonas.txt"
    } catch e {
    }
}
