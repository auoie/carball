// Decompiles functions into a given directory: DecompTo.java OUTDIR TARGET...
// TARGET: hex address (0x...), exact name (Class::func), "re:REGEX" on the full name, or "@FILE" (one target per line).
// @category BSim
import java.nio.file.*;
import java.util.*;
import java.util.regex.Pattern;

import ghidra.app.decompiler.*;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;

public class DecompTo extends GhidraScript {
	@Override
	protected void run() throws Exception {
		String[] args = getScriptArgs();
		Path outDir = Paths.get(args[0]);
		Files.createDirectories(outDir);
		List<String> specs = new ArrayList<>();
		for (int i = 1; i < args.length; i++) {
			if (args[i].startsWith("@")) specs.addAll(Files.readAllLines(Paths.get(args[i].substring(1))));
			else specs.add(args[i]);
		}
		Set<Function> targets = new LinkedHashSet<>();
		List<Pattern> pats = new ArrayList<>();
		Set<String> names = new HashSet<>();
		for (String s : specs) {
			s = s.trim();
			if (s.isEmpty()) continue;
			if (s.startsWith("0x")) {
				Address a = toAddr(Long.decode(s));
				Function f = getFunctionContaining(a);
				if (f == null) { disassemble(a); f = createFunction(a, null); }
				if (f != null) targets.add(f); else println("no function at " + s);
			}
			else if (s.startsWith("re:")) pats.add(Pattern.compile(s.substring(3)));
			else names.add(s);
		}
		if (!pats.isEmpty() || !names.isEmpty()) {
			for (Function f : currentProgram.getFunctionManager().getFunctions(true)) {
				String n = f.getName(true);
				if (names.contains(n)) { targets.add(f); continue; }
				for (Pattern p : pats) if (p.matcher(n).find()) { targets.add(f); break; }
			}
		}
		DecompInterface ifc = new DecompInterface();
		ifc.setOptions(new DecompileOptions());
		ifc.toggleCCode(true);
		ifc.openProgram(currentProgram);
		for (Function f : targets) {
			DecompileResults r = ifc.decompileFunction(f, 180, monitor);
			String name = f.getName(true).replaceAll("[^A-Za-z0-9_.:-]", "_").replace("::", "__");
			if (name.length() > 120) name = name.substring(0, 120);
			String body = r.decompileCompleted() ? r.getDecompiledFunction().getC()
					: "/* decompile failed: " + r.getErrorMessage() + " */";
			String header = "// " + f.getName(true) + " @ " + f.getEntryPoint() + " size " + f.getBody().getNumAddresses() + "\n";
			Files.writeString(outDir.resolve(name + "@" + f.getEntryPoint() + ".c"), header + body);
		}
		ifc.dispose();
		println("DecompTo: wrote " + targets.size() + " functions to " + outDir);
	}
}
