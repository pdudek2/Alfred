import { webFrame } from "electron";

// A page's print() opens a modal print panel that blocks Alfred's main process, even from a hidden window.
void webFrame.executeJavaScript("window.print = () => {};");
