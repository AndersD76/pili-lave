"use client";
import { useEffect } from "react";
import { sincronizarPush } from "./AvisosPush";

export function SwRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js")
      .then(() => sincronizarPush())
      .catch(() => {});
  }, []);
  return null;
}
