import { webFrame } from "electron";

// A page's print() opens a modal panel that stops the drawing process until Alfred kills it; this spares the main frame.
void webFrame.executeJavaScript("window.print = () => {};");
