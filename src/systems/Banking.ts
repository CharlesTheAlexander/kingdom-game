import Phaser from 'phaser';
import { Enemy } from './Waves.js';

// Banking.ts (Completion Phase 3) — the Treasury's reserves + loans.
//   Reserves earn 2% interest per game-week (7 days).
//   Loans (max 500g) must be repaid at +20% within 10 days; defaulting tanks
//   relations, doubles the debt daily, and at 3 days overdue spawns 3 debt
//   collectors that march on the castle until the loan is paid.
export class Banking {
  scene: any;
  reserves: number;
  loan: any; // { principal, owed, due, overdue, warned } | null
  history: any[];
  _interestAcc: number;
  _collectors: any[];
  [key: string]: any;

  constructor(scene: any) {
    this.scene = scene;
    this.reserves = 0;
    this.loan = null;
    this.history = [];
    this._interestAcc = 0;
    this._collectors = [];
  }

  hasTreasury(): boolean { return this.scene.buildings.countOfType('treasury') > 0; }
  weeklyInterest(): number { return Math.round(this.reserves * 0.02); }

  log(t: string) { this.history.unshift({ text: t, day: this.scene.gameDay }); if (this.history.length > 5) this.history.pop(); }

  deposit(amt: number) {
    amt = Math.min(amt, Math.floor(this.scene.resources.gold));
    if (amt <= 0) { this.scene.showToast && this.scene.showToast('Not enough gold'); return; }
    this.scene.resources.gold -= amt; this.reserves += amt; this.log(`Deposited ${amt}g`); this.refresh();
  }
  withdraw(amt: number) {
    amt = Math.min(amt, Math.floor(this.reserves));
    if (amt <= 0) return; this.reserves -= amt; this.scene.resources.add('gold', amt); this.log(`Withdrew ${amt}g`); this.refresh();
  }
  takeLoan(amt: number) {
    if (this.loan) { this.scene.showToast && this.scene.showToast('Repay your current loan first'); return; }
    amt = Math.min(Math.max(0, amt), 500); if (amt <= 0) return;
    this.scene.resources.add('gold', amt);
    this.loan = { principal: amt, owed: Math.round(amt * 1.2), due: this.scene.gameDay + 10, overdue: 0, warned: false };
    this.log(`Took loan ${amt}g (owe ${this.loan.owed})`); this.refresh();
  }
  repayLoan() {
    if (!this.loan) return;
    if (this.scene.resources.gold < this.loan.owed) { this.scene.showToast && this.scene.showToast(`Need ${this.loan.owed}g to repay`); return; }
    this.scene.resources.gold -= this.loan.owed; this.log(`Repaid loan (${this.loan.owed}g)`); this.loan = null; this.recallCollectors(); this.refresh();
  }

  recallCollectors() {
    for (const e of this._collectors) { if (e && e.alive) e.destroy(); }
    this._collectors = [];
  }
  spawnCollectors() {
    const s = this.scene, c = s.buildings.castle; if (!c) return;
    for (let i = 0; i < 3; i++) {
      const x = c.x + Phaser.Math.Between(-160, 160), y = c.y - 320;
      const e = new Enemy(s, x, y, 60, 3, { idle: 'yellow_warrior_idle', run: 'yellow_warrior_run' });
      e._debtCollector = true;
      if (s.waves) s.waves.enemies.push(e);
      this._collectors.push(e);
    }
    if (s.threatWarning) s.threatWarning('Debt collectors march on your castle!', 0xff4d4d, true);
    if (s.logEvent) s.logEvent('Debt collectors dispatched — repay or fight', 'red');
  }

  onNewDay() {
    const s = this.scene;
    // Weekly interest on reserves.
    this._interestAcc++;
    if (this._interestAcc >= 7) {
      this._interestAcc = 0;
      if (this.reserves > 0) { const i = this.weeklyInterest(); this.reserves += i; this.log(`Interest +${i}g`); if (s.logEvent) s.logEvent(`Treasury interest +${i} gold`, 'green'); }
    }
    // Loan overdue handling.
    if (this.loan && s.gameDay >= this.loan.due) {
      if (!this.loan.warned) {
        this.loan.warned = true;
        if (s.diplomacy) for (const k of s.kingdoms || []) s.diplomacy.change(k.cfg.key, -15, 'unpaid debt');
        if (s.threatWarning) s.threatWarning('Your creditors are calling in debts!', 0xff4d4d, true);
        if (s.logEvent) s.logEvent('Loan overdue — your creditors are calling in debts', 'red');
      } else {
        this.loan.overdue++;
        this.loan.owed *= 2; // debt doubles each day it stays unpaid
        if (this.loan.overdue >= 3 && this._collectors.filter((e) => e.alive).length === 0) this.spawnCollectors();
      }
    }
    this.refresh();
  }

  refresh() { if (this.scene._treasuryPanel && this.scene.openTreasuryPanel) this.scene.openTreasuryPanel(); }

  serialize() { return { reserves: this.reserves, loan: this.loan, interestAcc: this._interestAcc, history: this.history }; }
  restore(d: any) { if (!d) return; this.reserves = d.reserves || 0; this.loan = d.loan || null; this._interestAcc = d.interestAcc || 0; this.history = d.history || []; }
}
