%
O00009 (xxxxx)
(VMC Haas Chipfan Table Wash)
(Work offset=  G54.)
(Start Point = 1)
(Tool Number= T49)
(FAN= Y)
(Which Fan= L)
(X length= 5.)
(Y Length= 5.)
(Z height above G54.=3.)
(Number of Passes= 1)
(Spindle RPM= 5000)
(Feed Rate= 50.)
(End Program=30)
G53 G00 Z0
T49 M06
G00 G17 G40 G49 G80 G90
M03 S1500
G04 P0.5
M03 S5000
G00 G54. X0 Y-2.5
G43 H49
G00 Z3.
G90 G01 X5. F50.
G53 G00 Z0
M05
G53 G00 Y0
M30

%