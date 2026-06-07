# AUFKLÄRUNG KillSwitch-Doppel-Count (AUD-VOLL-035)
Datum: Mo 18 Mai 2026 10:54:47 CEST
Modus: READ-ONLY (kein Patch, kein Restart)

## LIVE-EVIDENZ
- Telegram-Alarme 10:38 + 10:43: KILLSWITCH_SANE bei DD 20.9%, Mode NORMAL
- INCIDENTS_MANAGED 100% (14 offene Incidents)

═══════════════════════════════════════════════════════════════════
1. KILLSWITCH-MODUL FINDEN
═══════════════════════════════════════════════════════════════════

4698:const KillSwitch = {

Definitions-Block Z.4698-4795 (mit aktuellem AUDFIX_E002 Patch):
 4698: const KillSwitch = {
 4699:   active:   false,
 4700:   mode:     'NORMAL', // NORMAL|RISK_COMPRESSION|EXIT_ONLY|HALTED
 4701:   triggers: [],
 4702: 
 4703:   check() {
 4704:     // KOMPLETT-FIX H [17.05.2026]: MBT-aware effectiveEquity statt nur LIVE-Balance.usable
 4705:     // - Im DEMO: rechnet mit Wallet-Total + MBT-Commit + Unrealized (Mark-to-Market)
 4706:     // - Im LIVE: rechnet weiter mit Balance.usable (LIVE-Bitget-Wallet, Mark-to-Market kommt in eigener Pipeline)
 4707:     // - AladdinBrain bleibt UNANGETASTET
 4708:     const isDemo = (DemoEngine && !DemoEngine.liveMode);
 4709:     let eq, peakRef, sessionStartRef;
 4710:     if (isDemo && typeof getEffectiveDemoEquity === 'function') {
 4711:       try {
 4712:         const eqInfo = getEffectiveDemoEquity();
 4713:         eq = eqInfo.effectiveTotal;
 4714:       } catch(_) {
 4715:         eq = (DemoEngine.wallet && DemoEngine.wallet.total) || 0;
 4716:       }
 4717:       // DEMO-Peak: persistent via DemoEngine.wallet.peakTotal (vorhanden)
 4718:       peakRef = (DemoEngine.wallet && DemoEngine.wallet.peakTotal) || 1000;
 4719:       sessionStartRef = (DemoEngine.wallet && DemoEngine.wallet.startTotal) || 1000;
 4720:     } else {
 4721:       eq = Balance.usable;
 4722:       peakRef = Balance.peakEquity;
 4723:       sessionStartRef = Balance.sessionStart;
 4724:     }
 4725:     // Glitch-Schutz (unverändert)
 4726:     if (!eq || eq <= 0) return { mode: this.mode, triggered: false, skipped: 'eq_invalid' };
 4727:     if (!peakRef || peakRef <= 10) return { mode: this.mode, triggered: false, skipped: 'peak_init' };
 4728:     if (peakRef > 0 && eq < peakRef * 0.5) {
 4729:       Log.warn('KILL', `Verdaechtiger eq-Einbruch ignoriert: peakEq=${peakRef.toFixed(2)} eq=${eq.toFixed(2)} (mode=${isDemo?'DEMO':'LIVE'})`);
 4730:       return { mode: this.mode, triggered: false, skipped: 'glitch_protection' };
 4731:     }
 4732:     // Peak-Update (nicht LIVE-Balance schreiben wenn DEMO)
 4733:     if (isDemo) {
 4734:       if (eq > peakRef) {
 4735:         try { DemoEngine.wallet.peakTotal = eq; } catch(_) {}
 4736:         peakRef = eq;
 4737:       }
 4738:     } else {
 4739:       if (eq > Balance.peakEquity) Balance.peakEquity = eq;
 4740:     }
 4741:     const drawdown = peakRef > 0 ? (peakRef-eq)/peakRef : 0;
 4742:     const dailyLoss = sessionStartRef > 0 ? (sessionStartRef-eq)/sessionStartRef : 0;
 4743:     if (drawdown >= CFG.MAX_DRAWDOWN_PCT) return this._hardKill('MAX_DRAWDOWN', { drawdown, eq, peakRef, mode: isDemo?'DEMO':'LIVE' });
 4744:     if (dailyLoss >= CFG.MAX_DAILY_LOSS_PCT) return this._hardKill('MAX_DAILY_LOSS', { dailyLoss, eq, sessionStartRef, mode: isDemo?'DEMO':'LIVE' });
 4745:     if (drawdown >= CFG.MAX_DRAWDOWN_PCT*0.7) return this._preKill('APPROACHING_DRAWDOWN', { drawdown, eq, mode: isDemo?'DEMO':'LIVE' });
 4746:     return { mode: this.mode, triggered: false };
 4747:   },
 4748: 
 4749:   _hardKill(reason, data) {
 4750:     this.active=true; this.mode='HALTED';
 4751:     this.triggers.push({ ts:Date.now(), reason, data, severity:'HARD' });
 4752:     Log.error('KILL', `HARD KILL: ${reason}`, data);
 4753:     return { mode:'HALTED', triggered:true, reason };
 4754:   },
 4755: 
 4756:   _preKill(reason, data) {
 4757:     this.mode='RISK_COMPRESSION';
 4758:     this.triggers.push({ ts:Date.now(), reason, data, severity:'PRE' });
 4759:     Log.warn('KILL', `PRE-KILL: ${reason}`, data);
 4760:     return { mode:'RISK_COMPRESSION', triggered:true, reason };
 4761:   },
 4762: 
 4763:   reset() { this.active=false; this.mode='NORMAL'; Log.info('KILL','Kill switch reset'); },
 4764:   snapshot() {
 4765:     // FIX-V [18.05.2026] DEMO-aware peakEquity (Audit A-1).
 4766:     // check() arbeitet bereits korrekt mit DemoEngine.wallet.peakTotal in DEMO;
 4767:     // snapshot() lieferte aber Balance.peakEquity (LIVE-Bitget 56.71) auch im PAPER-Mode.
 4768:     const isDemo = (typeof DemoEngine !== 'undefined' && DemoEngine && !DemoEngine.liveMode);
 4769:     const peak = isDemo
 4770:       ? ((DemoEngine.wallet && DemoEngine.wallet.peakTotal) || Balance.peakEquity)
 4771:       : Balance.peakEquity;
 4772:     return { active: this.active, mode: this.mode, triggers: this.triggers.slice(-5), peakEquity: peak };
 4773:   }
 4774: };

═══════════════════════════════════════════════════════════════════
2. PEAKTOTAL-LOGIK — alle Stellen
═══════════════════════════════════════════════════════════════════

--- Vorkommen (grep -n peakTotal) ---
4717:      // DEMO-Peak: persistent via DemoEngine.wallet.peakTotal (vorhanden)
4718:      peakRef = (DemoEngine.wallet && DemoEngine.wallet.peakTotal) || 1000;
4735:        try { DemoEngine.wallet.peakTotal = eq; } catch(_) {}
4766:    // check() arbeitet bereits korrekt mit DemoEngine.wallet.peakTotal in DEMO;
4770:      ? ((DemoEngine.wallet && DemoEngine.wallet.peakTotal) || Balance.peakEquity)
10035:    if (w.total > (w.peakTotal||0)) w.peakTotal = w.total;
10095:        peakTotal: DemoEngine.wallet.peakTotal,
16754:  DemoEngine.wallet = { total:cap, reserve:0, trading:cap, startTotal:cap, peakTotal:cap, dailyStart:cap, pnl:0, dailyPnl:0 };
19706:      const peak = isPaper ? (DemoEngine.wallet?.peakTotal || 1000) : Balance.peakEquity;
21914:    peakTotal:  1000,
21955:      this.wallet.startTotal=capital; this.wallet.peakTotal=capital; this.wallet.dailyStart=capital;
22950:    const dd    = this.wallet.peakTotal > 0
22951:      ? ((this.wallet.peakTotal-this.wallet.total)/this.wallet.peakTotal*100).toFixed(2)
22986:        maxDD:     this.wallet.peakTotal>0 ? (this.wallet.peakTotal-this.wallet.total)/this.wallet.peakTotal : 0,
24848:        'Peak: '+(w.peakTotal||0).toFixed(2)+' USDT',
