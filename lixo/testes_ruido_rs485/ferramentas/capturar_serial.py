import serial, sys, time

port = sys.argv[1]
duration = float(sys.argv[2])
out_path = sys.argv[3]

t0 = time.time()
with open(out_path, "ab", buffering=0) as f:
    while time.time() - t0 < duration:
        try:
            ser = serial.Serial(port, 115200, timeout=0.2)
            ser.dtr = False
            ser.rts = False
            # NAO reabre a porta periodicamente: cada open() reseta a placa
            # (USB-CDC nativo do ESP32-S3), entao so reconecta se der erro de
            # verdade (porta sumiu/caiu), nao por rotina.
            while time.time() - t0 < duration:
                data = ser.read(4096)
                if data:
                    f.write(data)
        except Exception:
            time.sleep(0.3)
        finally:
            try:
                ser.close()
            except Exception:
                pass
