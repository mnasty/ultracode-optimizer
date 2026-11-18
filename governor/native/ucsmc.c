// ucsmc: read the Mac's temperatures, fans and thermal pressure, and (as root) drive the fans.
//
//   ucsmc sense                 one JSON line: temps, cpu max/avg, fans, thermal pressure (no root needed)
//   ucsmc fan auto              give every fan back to the system (root)
//   ucsmc fan set <rpm>         force every fan to <rpm>, clamped to its own min..max (root)
//   ucsmc fan frac <0..1>       force every fan to that fraction of its own min..max range (root)
//   ucsmc fand <request.json>   root daemon: every second apply {"frac":<0..1|null>,"t":<epoch ms>} from the request file;
//                               a missing, stale (>15 s) or null request means automatic. SIGTERM/SIGINT -> automatic.
//                               A request is never applied below the helper's own floor (its own die temperature on the
//                               governor's curve, raised by macOS thermal pressure): a request can add cooling, never remove it.
//   add --dry to any write command to print the SMC writes instead of doing them.
//
// Build: clang -O2 -o ucsmc ucsmc.c -framework IOKit -framework CoreFoundation
#include <IOKit/IOKitLib.h>
#include <CoreFoundation/CoreFoundation.h>
#include <notify.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/time.h>
#include <time.h>
#include <unistd.h>

// ---------- SMC (AppleSMC user client) ----------
typedef struct { char major, minor, build, reserved; UInt16 release; } SMCVers;
typedef struct { UInt16 version, length; UInt32 cpuPLimit, gpuPLimit, memPLimit; } SMCPLimit;
typedef struct { UInt32 dataSize; UInt32 dataType; char dataAttributes; } SMCKeyInfo;
typedef struct {
  UInt32 key; SMCVers vers; SMCPLimit pLimitData; SMCKeyInfo keyInfo;
  char result, status, data8; UInt32 data32; unsigned char bytes[32];
} SMCParam;
enum { KERNEL_INDEX_SMC = 2, SMC_READ = 5, SMC_WRITE = 6, SMC_KEYINFO = 9 };

static io_connect_t smc = 0;
static int dry = 0;

static UInt32 k4(const char *s) { return ((UInt32)s[0] << 24) | ((UInt32)s[1] << 16) | ((UInt32)s[2] << 8) | (UInt32)s[3]; }
static void s4(UInt32 v, char *o) { o[0] = v >> 24; o[1] = v >> 16; o[2] = v >> 8; o[3] = v; o[4] = 0; }

static int smcOpen(void) {
  io_service_t svc = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("AppleSMC"));
  if (!svc) return -1;
  kern_return_t kr = IOServiceOpen(svc, mach_task_self(), 0, &smc);
  IOObjectRelease(svc);
  return kr == KERN_SUCCESS ? 0 : -1;
}
static int smcCall(SMCParam *in, SMCParam *out) {
  size_t n = sizeof(SMCParam);
  return IOConnectCallStructMethod(smc, KERNEL_INDEX_SMC, in, sizeof(SMCParam), out, &n) == KERN_SUCCESS ? 0 : -1;
}
static int smcInfo(const char *key, SMCKeyInfo *info) {
  SMCParam in = {0}, out = {0};
  in.key = k4(key); in.data8 = SMC_KEYINFO;
  if (smcCall(&in, &out) || out.result) return -1;
  *info = out.keyInfo; return 0;
}
static int smcRead(const char *key, unsigned char *buf, UInt32 *size, UInt32 *type) {
  SMCKeyInfo info; if (smcInfo(key, &info)) return -1;
  SMCParam in = {0}, out = {0};
  in.key = k4(key); in.keyInfo.dataSize = info.dataSize; in.data8 = SMC_READ;
  if (smcCall(&in, &out) || out.result) return -1;
  memcpy(buf, out.bytes, info.dataSize); *size = info.dataSize; if (type) *type = info.dataType; return 0;
}
static int smcWrite(const char *key, const unsigned char *buf, UInt32 size) {
  if (dry) {
    printf("{\"dry\":true,\"write\":\"%s\",\"bytes\":[", key);
    for (UInt32 i = 0; i < size; i++) printf("%s%u", i ? "," : "", buf[i]);
    printf("]}\n"); return 0;
  }
  SMCParam in = {0}, out = {0};
  in.key = k4(key); in.data8 = SMC_WRITE; in.keyInfo.dataSize = size; memcpy(in.bytes, buf, size);
  if (smcCall(&in, &out) || out.result) return -1;
  return 0;
}
// a numeric SMC value: flt (Apple Silicon), fpe2 (Intel), ui8/ui16/ui32
static int smcNum(const char *key, double *v) {
  unsigned char b[32]; UInt32 size, type; char t[5];
  if (smcRead(key, b, &size, &type)) return -1;
  s4(type, t);
  if (!strcmp(t, "flt ") && size == 4) { float f; memcpy(&f, b, 4); *v = f; return 0; }
  if (!strcmp(t, "fpe2") && size == 2) { *v = ((b[0] << 8) | b[1]) / 4.0; return 0; }
  if (!strcmp(t, "ui8 ") && size == 1) { *v = b[0]; return 0; }
  if (!strcmp(t, "ui16") && size == 2) { *v = (b[0] << 8) | b[1]; return 0; }
  if (!strcmp(t, "ui32") && size == 4) { *v = ((UInt32)b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]; return 0; }
  return -1;
}
static int smcType(const char *key, char *t, UInt32 *size) {
  SMCKeyInfo info; if (smcInfo(key, &info)) return -1;
  s4(info.dataType, t); *size = info.dataSize; return 0;
}
static int writeNum(const char *key, double v) {
  char t[5]; UInt32 size; unsigned char b[32] = {0};
  if (smcType(key, t, &size)) return -1;
  if (!strcmp(t, "flt ") && size == 4) { float f = (float)v; memcpy(b, &f, 4); }
  else if (!strcmp(t, "fpe2") && size == 2) { int x = (int)(v * 4); b[0] = x >> 8; b[1] = x & 0xff; }
  else if (!strcmp(t, "ui8 ") && size == 1) { b[0] = (unsigned char)v; }
  else return -1;
  return smcWrite(key, b, size);
}

static int fanCount(void) { double n; return smcNum("FNum", &n) ? 0 : (int)n; }
static void key(char *o, const char *fmt, int i) { snprintf(o, 5, fmt, i); }

// ---------- temperatures (IOHID sensors; readable without root on Apple Silicon) ----------
typedef struct __IOHIDEvent *IOHIDEventRef;
typedef struct __IOHIDServiceClient *IOHIDServiceClientRef;
typedef struct __IOHIDEventSystemClient *IOHIDEventSystemClientRef;
extern IOHIDEventSystemClientRef IOHIDEventSystemClientCreate(CFAllocatorRef);
extern int IOHIDEventSystemClientSetMatching(IOHIDEventSystemClientRef, CFDictionaryRef);
extern CFArrayRef IOHIDEventSystemClientCopyServices(IOHIDEventSystemClientRef);
extern IOHIDEventRef IOHIDServiceClientCopyEvent(IOHIDServiceClientRef, int64_t, int32_t, int64_t);
extern CFTypeRef IOHIDServiceClientCopyProperty(IOHIDServiceClientRef, CFStringRef);
extern double IOHIDEventGetFloatValue(IOHIDEventRef, int32_t);
#define kIOHIDEventTypeTemperature 15

static void jsonStr(const char *s) {
  putchar('"');
  for (; *s; s++) { if (*s == '"' || *s == '\\') putchar('\\'); if ((unsigned char)*s >= 32) putchar(*s); }
  putchar('"');
}

// thermal pressure: 0 nominal, 1 moderate, 2 heavy, 3 trapping, 4 sleeping
static uint64_t thermalLevel(void) {
  int tok; uint64_t tp = 0;
  if (notify_register_check("com.apple.system.thermalpressurelevel", &tok) == NOTIFY_STATUS_OK) { notify_get_state(tok, &tp); notify_cancel(tok); }
  return tp;
}
// every temperature sensor; cpuMax/cpuAvg over the die sensors (tdie*), allMax over all but the calibration value.
// print != 0 also writes them as a JSON array of [name, celsius] pairs (names repeat across sensors)
static void temps(double *cpuMax, double *cpuAvg, double *allMax, int print) {
  double cm = -1, cs = 0, am = -1; int cn = 0, first = 1;
  IOHIDEventSystemClientRef sys = IOHIDEventSystemClientCreate(kCFAllocatorDefault);
  if (sys) {
    int page = 0xff00, usage = 5;
    CFNumberRef p = CFNumberCreate(NULL, kCFNumberIntType, &page), u = CFNumberCreate(NULL, kCFNumberIntType, &usage);
    const void *ks[] = { CFSTR("PrimaryUsagePage"), CFSTR("PrimaryUsage") }, *vs[] = { p, u };
    CFDictionaryRef m = CFDictionaryCreate(NULL, ks, vs, 2, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    IOHIDEventSystemClientSetMatching(sys, m);
    CFArrayRef svcs = IOHIDEventSystemClientCopyServices(sys);
    for (CFIndex i = 0; svcs && i < CFArrayGetCount(svcs); i++) {
      IOHIDServiceClientRef s = (IOHIDServiceClientRef)CFArrayGetValueAtIndex(svcs, i);
      CFStringRef name = IOHIDServiceClientCopyProperty(s, CFSTR("Product"));
      IOHIDEventRef ev = IOHIDServiceClientCopyEvent(s, kIOHIDEventTypeTemperature, 0, 0);
      if (name && ev) {
        double c = IOHIDEventGetFloatValue(ev, kIOHIDEventTypeTemperature << 16);
        char nm[128]; CFStringGetCString(name, nm, sizeof nm, kCFStringEncodingUTF8);
        if (c > 0 && c < 150) {
          if (print) { printf("%s[", first ? "" : ","); jsonStr(nm); printf(",%.1f]", c); first = 0; }
          if (c > am && !strstr(nm, "tcal")) am = c;
          if (strstr(nm, "tdie")) { if (c > cm) cm = c; cs += c; cn++; }
        }
      }
      if (ev) CFRelease(ev);
      if (name) CFRelease(name);
    }
    if (svcs) CFRelease(svcs);
    CFRelease(m); CFRelease(p); CFRelease(u); CFRelease(sys);
  }
  if (cn == 0) cm = am;
  *cpuMax = cm; *cpuAvg = cn ? cs / cn : cm; *allMax = am;
}

static int sense(void) {
  uint64_t tp = thermalLevel();
  printf("{\"t\":%.0f,\"thermalPressure\":%llu,\"temps\":[", (double)time(NULL) * 1000, tp);
  double cpuMax, cpuAvg, allMax; temps(&cpuMax, &cpuAvg, &allMax, 1);
  printf("],\"cpuMaxC\":%.1f,\"cpuAvgC\":%.1f,\"maxC\":%.1f,\"fans\":[", cpuMax, cpuAvg, allMax);

  int n = smcOpen() == 0 ? fanCount() : 0;
  for (int i = 0; i < n; i++) {
    char k[5]; double ac = -1, mn = -1, mx = -1, tg = -1, md = -1;
    key(k, "F%dAc", i); smcNum(k, &ac); key(k, "F%dMn", i); smcNum(k, &mn); key(k, "F%dMx", i); smcNum(k, &mx);
    key(k, "F%dTg", i); smcNum(k, &tg); key(k, "F%dMd", i); smcNum(k, &md);
    printf("%s{\"id\":%d,\"rpm\":%.0f,\"min\":%.0f,\"max\":%.0f,\"target\":%.0f,\"mode\":%.0f}", i ? "," : "", i, ac, mn, mx, tg, md);
  }
  printf("]}\n");
  return 0;
}

// ---------- fan writes (root) ----------
static int unlocked = 0;
static int fanForce(double rpm) {
  int n = fanCount(); if (!n) { fprintf(stderr, "no fans\n"); return -1; }
  int bad = 0;
  for (int i = 0; i < n; i++) {
    char k[5]; double mn = 0, mx = 0;
    key(k, "F%dMn", i); smcNum(k, &mn); key(k, "F%dMx", i); smcNum(k, &mx);
    double r = rpm < mn ? mn : rpm > mx && mx > 0 ? mx : rpm;
    key(k, "F%dMd", i);
    if (writeNum(k, 1)) {
      // Apple Silicon needs the Ftst unlock before forced mode is accepted
      if (!unlocked && writeNum("Ftst", 1) == 0) unlocked = 1;
      if (writeNum(k, 1)) { bad = 1; continue; }
    }
    key(k, "F%dTg", i); if (writeNum(k, r)) bad = 1;
  }
  return bad ? -1 : 0;
}
static int fanForceFrac(double frac) {
  int n = fanCount(); if (!n) return -1;
  int bad = 0;
  if (frac < 0) frac = 0; if (frac > 1) frac = 1;
  for (int i = 0; i < n; i++) {
    char k[5]; double mn = 0, mx = 0;
    key(k, "F%dMn", i); smcNum(k, &mn); key(k, "F%dMx", i); smcNum(k, &mx);
    double r = mn + (mx - mn) * frac;
    key(k, "F%dMd", i);
    if (writeNum(k, 1)) { if (!unlocked && writeNum("Ftst", 1) == 0) unlocked = 1; if (writeNum(k, 1)) { bad = 1; continue; } }
    key(k, "F%dTg", i); if (writeNum(k, r)) bad = 1;
  }
  return bad ? -1 : 0;
}
static int fanAuto(void) {
  int n = fanCount(), bad = 0;
  for (int i = 0; i < n; i++) { char k[5]; key(k, "F%dMd", i); if (writeNum(k, 0)) bad = 1; }
  if (unlocked || !dry) writeNum("Ftst", 0); // harmless if the key doesn't exist
  unlocked = 0;
  return bad ? -1 : 0;
}

// the helper's own heat curve, always on (whatever is running): from the minimum at 50 C to full speed at 80 C (176 F)
#define FLOOR_COOL_C 50.0
#define FLOOR_HOT_C 80.0
#define COOL_TICKS 30 // seconds below the curve before the fans go back to macOS
static volatile sig_atomic_t stop = 0;
static void onSig(int s) { (void)s; stop = 1; }
static double nowMs(void) { struct timeval tv; gettimeofday(&tv, NULL); return tv.tv_sec * 1000.0 + tv.tv_usec / 1000.0; }

// the request file holds {"frac":<0..1|null>,"t":<epoch ms>}; parse only those two numbers
static int readRequest(const char *path, double *rpm, double *t) {
  FILE *f = fopen(path, "r"); if (!f) return -1;
  char b[512]; size_t n = fread(b, 1, sizeof b - 1, f); fclose(f); b[n] = 0;
  char *r = strstr(b, "\"frac\""), *tt = strstr(b, "\"t\"");
  if (!r || !tt) return -1;
  r = strchr(r, ':'); tt = strchr(tt, ':'); if (!r || !tt) return -1;
  while (*++r == ' ');
  *rpm = strncmp(r, "null", 4) ? atof(r) : -1;
  *t = atof(tt + 1);
  return 0;
}

// ---------- the helper loop: it shares the fans with other controllers (e.g. Macs Fan Control) and never takes cooling away ----------
// - it forces a fan only when the request (or its own floor) wants more than the fan already gets: a fan another controller
//   forces at a higher target is left alone;
// - it hands back only fans it forced itself and nobody changed since (so a max set elsewhere survives the end of our work);
// - it writes nothing at start, and nothing while there is no request.
#define MAXFANS 8
static double simMd[MAXFANS], simTg[MAXFANS]; static int simOn = 0; // --dry: a simulated fan state (writes update it)
static void fanState(int i, double *md, double *tg) {
  if (simOn) { *md = simMd[i]; *tg = simTg[i]; return; }
  char k[5]; *md = -1; *tg = -1; key(k, "F%dMd", i); smcNum(k, md); key(k, "F%dTg", i); smcNum(k, tg);
}
static void simInit(int n) {
  if (!dry) return;
  for (int i = 0; i < n && i < MAXFANS; i++) fanState(i, &simMd[i], &simTg[i]);
  const char *e = getenv("UCSMC_TEST_FANS"); // tests only, and only with --dry: "mode:target,mode:target"
  for (int i = 0; e && *e && i < n && i < MAXFANS; i++) { simMd[i] = atof(e); const char *c = strchr(e, ':'); if (c) simTg[i] = atof(c + 1); e = strchr(e, ','); if (e) e++; }
  simOn = 1;
}
static int fanSetOne(int i, double r) {
  char k[5]; key(k, "F%dMd", i);
  if (writeNum(k, 1)) { if (!unlocked && writeNum("Ftst", 1) == 0) unlocked = 1; if (writeNum(k, 1)) return -1; }
  key(k, "F%dTg", i); if (writeNum(k, r)) return -1;
  if (simOn) { simMd[i] = 1; simTg[i] = r; }
  return 0;
}
static int fanAutoOne(int i) {
  char k[5]; key(k, "F%dMd", i); int bad = writeNum(k, 0);
  if (simOn) simMd[i] = 0;
  return bad;
}
static int stillMine(double md, double tg, double mine) { return mine >= 0 && md == 1 && tg > mine - 60 && tg < mine + 60; }
// give back the fans this helper forced, unless another controller has changed them since
static void handBack(int n, double *mine) {
  int forced = 0;
  for (int i = 0; i < n; i++) {
    if (mine[i] < 0) continue;
    double md, tg; fanState(i, &md, &tg);
    if (stillMine(md, tg, mine[i])) { fanAutoOne(i); fprintf(stderr, "ucsmc fand: fan %d automatic\n", i); }
    else fprintf(stderr, "ucsmc fand: fan %d was changed by another controller (mode %.0f, target %.0f): left as it is\n", i, md, tg);
    mine[i] = -1;
  }
  for (int i = 0; i < n; i++) { double md, tg; fanState(i, &md, &tg); if (md == 1) forced = 1; }
  if (unlocked && !forced) { writeNum("Ftst", 0); unlocked = 0; }
}

static int fand(const char *path) {
  signal(SIGTERM, onSig); signal(SIGINT, onSig); signal(SIGHUP, onSig);
  int n = fanCount(); if (n > MAXFANS) n = MAXFANS;
  simInit(n);
  double mine[MAXFANS], lastWant = -1; int left[MAXFANS], coolFor = 0;
  int coolTicks = dry && getenv("UCSMC_TEST_COOL_TICKS") ? atoi(getenv("UCSMC_TEST_COOL_TICKS")) : COOL_TICKS;
  for (int i = 0; i < MAXFANS; i++) { mine[i] = -1; left[i] = 0; }
  while (!stop) {
    double req = -1, t = 0;
    if (readRequest(path, &req, &t) || nowMs() - t > 15000) req = -1; // stale or missing -> no request
    // safety floor from the helper's own sensors: a request can add cooling, never take it away.
    // it applies with or without a request: hot dies always get the fans; raised by macOS thermal pressure
    double cpuMax, cpuAvg, allMax; temps(&cpuMax, &cpuAvg, &allMax, 0);
    uint64_t tp = thermalLevel();
    if (dry && getenv("UCSMC_TEST_TEMP")) cpuMax = atof(getenv("UCSMC_TEST_TEMP")); // tests only, and only with --dry
    if (dry && getenv("UCSMC_TEST_TEMP_FILE")) { FILE *tf = fopen(getenv("UCSMC_TEST_TEMP_FILE"), "r"); if (tf) { double x; if (fscanf(tf, "%lf", &x) == 1) cpuMax = x; fclose(tf); } }
    if (dry && getenv("UCSMC_TEST_TP")) tp = (uint64_t)atoi(getenv("UCSMC_TEST_TP"));
    double floor = (cpuMax - FLOOR_COOL_C) / (FLOOR_HOT_C - FLOOR_COOL_C);
    if (floor < 0) floor = 0; if (floor > 1) floor = 1;
    if (tp >= 2) floor = 1; else if (tp >= 1 && floor < 0.5) floor = 0.5;
    double want = req > floor ? req : (floor > 0 ? floor : -1);
    if (want >= 0) coolFor = 0; else if (lastWant >= 0 && ++coolFor < coolTicks) want = 0; // hold the minimum until it stays cool
    if (want > 1) want = 1;
    if (want >= 0) {
      for (int i = 0; i < n; i++) {
        char k[5]; double mn = 0, mx = 0, md, tg;
        key(k, "F%dMn", i); smcNum(k, &mn); key(k, "F%dMx", i); smcNum(k, &mx);
        double r = mn + (mx - mn) * want;
        fanState(i, &md, &tg);
        int ours = stillMine(md, tg, mine[i]);
        if (md == 1 && !ours && tg >= r - 60) { // another controller already forces at least this much: leave it
          if (!left[i]) fprintf(stderr, "ucsmc fand: fan %d is forced to %.0f rpm by another controller (we want %.0f): left as it is\n", i, tg, r);
          left[i] = 1; mine[i] = -1; continue;
        }
        left[i] = 0;
        if (ours && r > mine[i] - (mx - mn) * 0.02 && r < mine[i] + (mx - mn) * 0.02) continue; // already there
        if (fanSetOne(i, r) == 0) {
          mine[i] = r;
          if (want < lastWant - 0.02 || want > lastWant + 0.02) { fprintf(stderr, "ucsmc fand: forced %.0f%% of range (asked %.0f%%, floor %.0f%% at %.1f C, thermal %llu)\n", want * 100, req * 100, floor * 100, cpuMax, tp); lastWant = want; }
        }
      }
    } else { int any = 0; for (int i = 0; i < n; i++) if (mine[i] >= 0) any = 1; if (any) handBack(n, mine); lastWant = -1; coolFor = 0; for (int i = 0; i < n; i++) left[i] = 0; }
    if (dry) fflush(stdout);
    for (int i = 0; i < 10 && !stop; i++) usleep(100000);
  }
  handBack(n, mine);
  fprintf(stderr, "ucsmc fand: stopped\n");
  return 0;
}

int main(int argc, char **argv) {
  int ai = 1;
  for (int i = 1; i < argc; i++) if (!strcmp(argv[i], "--dry")) { dry = 1; for (int j = i; j < argc - 1; j++) argv[j] = argv[j + 1]; argc--; i--; }
  if (argc < 2) { fprintf(stderr, "usage: ucsmc sense | fan auto | fan set <rpm> | fan frac <0..1> | fand <request.json> [--dry]\n"); return 2; }
  const char *cmd = argv[ai];
  if (!strcmp(cmd, "sense")) return sense();
  if (smcOpen()) { fprintf(stderr, "ucsmc: cannot open AppleSMC\n"); return 1; }
  if (!strcmp(cmd, "fan") && argc >= 3 && !strcmp(argv[2], "auto")) return fanAuto() ? 1 : 0;
  if (!strcmp(cmd, "fan") && argc >= 4 && !strcmp(argv[2], "set")) return fanForce(atof(argv[3])) ? 1 : 0;
  if (!strcmp(cmd, "fan") && argc >= 4 && !strcmp(argv[2], "frac")) return fanForceFrac(atof(argv[3])) ? 1 : 0;
  if (!strcmp(cmd, "fand") && argc >= 3) return fand(argv[2]);
  fprintf(stderr, "ucsmc: unknown command\n"); return 2;
}
