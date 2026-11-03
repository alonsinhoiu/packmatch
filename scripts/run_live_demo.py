#!/usr/bin/env python3
"""
Demostración automatizada en vivo para Safari:
1. Activa Safari y abre http://localhost:3001
2. Abre la Opción B (Pegar datos)
3. Pega los datos del embarque simulado (INV-2026-9042 y PL-2026-9042)
4. Ejecuta el cruce
5. Muestra Paso 1: Diagnóstico en 3 segundos
6. Avanza a Paso 2: Documentos Lado a Lado
7. Avanza a Paso 3: Matriz SKU por SKU
8. Avanza a Paso 4: Minuta para el proveedor
"""

import time
import subprocess

def run_apple_script(script: str) -> str:
    res = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
    if res.returncode != 0:
        print("AppleScript error:", res.stderr.strip())
    return res.stdout.strip()

INV_DATA = """SKU-A101\tSmart Bluetooth Sensor Beacon IP67\t500\tPCS\t12.00\t6000.00
SKU-B202\tIndustrial Stainless Valve Kit (1 SET = 2 PCS)\t80\tSETS\t95.00\t7600.00
SKU-C303\tHeavy Duty Fasteners Steel Grade 8.8\t200\tPCS\t15.00\t3000.00"""

PL_DATA = """CTN 01-10\tSKU-A101\t10\t50\t500\t120.00\t135.00\tKG
CTN 11-20\tSKU-B202\t10\t7\t70\t680.00\t760.00\tKG
CTN 21-25\tSKU-C303\t5\t40\t200\t180.00\t160.00\tKG"""

def main():
    print("Iniciando prueba en vivo en Safari...")

    # Paso 1: Llevar Safari al frente y recargar localhost:3001
    run_apple_script("""
    tell application "Safari"
        activate
        tell window 1
            set current tab to (first tab whose URL starts with "http://localhost:3001")
            set URL of current tab to "http://localhost:3001"
        end tell
    end tell
    """)
    time.sleep(2.0)

    # Paso 2: Abrir el modal de Pegar Datos (Opción B)
    print("Abriendo Opción B (Pegar datos desde Excel / CSV)...")
    run_apple_script("""
    tell application "System Events"
        tell process "Safari"
            set frontmost to true
            tell front window
                tell splitter group 1
                    tell tab group 1
                        tell group 1
                            tell group 1
                                tell scroll area 1
                                    tell UI element 1
                                        tell group 2
                                            tell group "Pegar desde Excel o CSV"
                                                tell group 2
                                                    click button 1
                                                end tell
                                            end tell
                                        end tell
                                    end tell
                                end tell
                            end tell
                        end tell
                    end tell
                end tell
            end tell
        end tell
    end tell
    """)
    time.sleep(1.5)

    # Paso 3: Pegar los datos de Factura y Packing List
    print("Ingresando datos del embarque...")
    paste_script = f"""
    set invData to "{INV_DATA}"
    set plData to "{PL_DATA}"

    tell application "System Events"
        tell process "Safari"
            set frontmost to true
            tell front window
                tell splitter group 1
                    tell tab group 1
                        tell group 1
                            tell group 1
                                tell scroll area 1
                                    tell UI element 1
                                        tell group "Pegar celdas desde Excel / CSV"
                                            set t1 to (first text area whose name starts with "Factura Comercial")
                                            set focused of t1 to true
                                            set value of attribute "AXValue" of t1 to invData
                                            keystroke " "
                                            key code 51
                                            delay 0.3

                                            set t2 to (first text area whose name starts with "Lista de Empaque")
                                            set focused of t2 to true
                                            set value of attribute "AXValue" of t2 to plData
                                            keystroke " "
                                            key code 51
                                            delay 0.5

                                            click button "Cruzar datos ahora"
                                        end tell
                                    end tell
                                end tell
                            end tell
                        end tell
                    end tell
                end tell
            end tell
        end tell
    end tell
    """
    run_apple_script(paste_script)
    time.sleep(2.0)

    print("Cruce realizado. Mostrando Paso 1: Diagnóstico General (Veredicto y Alertas en 1 columna)...")
    time.sleep(4.0)

    # Paso 4: Avanzar al Paso 2 (Documentos Lado a Lado)
    print("Avanzando a Paso 2: Cotejo en Documentos Originales...")
    run_apple_script("""
    tell application "System Events"
        tell process "Safari"
            set frontmost to true
            tell front window
                tell splitter group 1
                    tell tab group 1
                        tell group 1
                            tell group 1
                                tell scroll area 1
                                    tell UI element 1
                                        click (first button whose name starts with "Inspeccionar Evidencia")
                                    end tell
                                end tell
                            end tell
                        end tell
                    end tell
                end tell
            end tell
        end tell
    end tell
    """)
    time.sleep(4.0)

    # Paso 5: Avanzar al Paso 3 (Matriz por Producto)
    print("Avanzando a Paso 3: Matriz por Producto SKU por SKU...")
    run_apple_script("""
    tell application "System Events"
        tell process "Safari"
            set frontmost to true
            tell front window
                tell splitter group 1
                    tell tab group 1
                        tell group 1
                            tell group 1
                                tell scroll area 1
                                    tell UI element 1
                                        click (first button whose name starts with "Continuar a la Matriz")
                                    end tell
                                end tell
                            end tell
                        end tell
                    end tell
                end tell
            end tell
        end tell
    end tell
    """)
    time.sleep(4.0)

    # Paso 6: Avanzar al Paso 4 (Mensaje al Proveedor)
    print("Avanzando a Paso 4: Mensaje para el Proveedor y Exportación...")
    run_apple_script("""
    tell application "System Events"
        tell process "Safari"
            set frontmost to true
            tell front window
                tell splitter group 1
                    tell tab group 1
                        tell group 1
                            tell group 1
                                tell scroll area 1
                                    tell UI element 1
                                        click (first button whose name starts with "Generar Mensaje")
                                    end tell
                                end tell
                            end tell
                        end tell
                    end tell
                end tell
            end tell
        end tell
    end tell
    """)
    time.sleep(4.0)

    # Regresar al Paso 1 para que el usuario pueda empezar a interactuar
    print("Volviendo a Paso 1: Diagnóstico General...")
    run_apple_script("""
    tell application "System Events"
        tell process "Safari"
            set frontmost to true
            tell front window
                tell splitter group 1
                    tell tab group 1
                        tell group 1
                            tell group 1
                                tell scroll area 1
                                    tell UI element 1
                                        click (first button whose name starts with "← Volver al Diagnóstico")
                                    end tell
                                end tell
                            end tell
                        end tell
                    end tell
                end tell
            end tell
        end tell
    end tell
    """)
    print("Demostración secuencial completada con éxito.")

if __name__ == "__main__":
    main()
